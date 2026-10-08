import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session as electronSession,
} from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "./store";
import { SSHService } from "./ssh";
import { LocalTerminals } from "./terminal";
import { AgentService, findExecutable } from "./agent";
import { Approvals } from "./approvals";
import {
  agentSchema,
  commandSchema,
  idSchema,
  serverSchema,
  settingsSchema,
  sessionPatchSchema,
  agentSelectionSchema,
  projectSchema,
} from "../shared/validation";
import type { AppEvent } from "../shared/types";
import { cliArguments } from "./cli";
import { localDiagnostics } from "./modes";
import { executeLocal } from "./local-command";

let window: BrowserWindow | undefined;
let store: Store,
  ssh: SSHService,
  terminals: LocalTerminals,
  agent: AgentService;
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) {
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  app.setPath("userData", profileDirectory);
}
const approvals = new Approvals();
const output = new Map<string, string>();
const sessionTasks = new Set<string>();
const sessionExecutions = new Map<string, number>();
let outputTimer: ReturnType<typeof setTimeout> | undefined;
function emit(event: AppEvent) {
  if (event.type === "terminal:data") {
    const previous = output.get(event.id) ?? "";
    const combined = previous + event.data;
    output.set(
      event.id,
      combined.length > 262144
        ? "\r\n[输出过快，已丢弃部分内容]\r\n" + combined.slice(-262144)
        : combined,
    );
    if (!outputTimer)
      outputTimer = setTimeout(() => {
        outputTimer = undefined;
        for (const [id, data] of output)
          window?.webContents.send("app:event", {
            type: "terminal:data",
            id,
            data,
          });
        output.clear();
      }, 24);
  } else {
    if (event.type === "terminal:closed" && output.has(event.id)) {
      window?.webContents.send("app:event", {
        type: "terminal:data",
        id: event.id,
        data: output.get(event.id),
      });
      output.delete(event.id);
    }
    window?.webContents.send("app:event", event);
  }
}
function registerIPC() {
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(name, (event, ...args) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("不受信任的调用来源");
      return fn(...args);
    });
  handle("servers:list", () => store.listServers());
  handle("projects:list", () => store.projects());
  handle("projects:save", (input) => {
    const parsed = projectSchema.parse(input);
    if (parsed.id) {
      const previous = store.project(parsed.id);
      const includeLocal = parsed.includeLocal ?? previous.includeLocal;
      const directory =
        parsed.directory === undefined
          ? previous.directory
          : store.normalizeDirectory(parsed.directory);
      if (
        (directory !== previous.directory ||
          includeLocal !== previous.includeLocal ||
          (parsed.remoteDirectory !== undefined &&
            parsed.remoteDirectory !== (previous.remoteDirectory ?? "")) ||
          (parsed.serverIds &&
            JSON.stringify([...parsed.serverIds].sort()) !==
              JSON.stringify([...previous.serverIds].sort()))) &&
        store
          .sessions()
          .some((s) => s.projectId === parsed.id && sessionTasks.has(s.id))
      )
        throw new Error("项目中有任务正在运行，请先停止任务再修改目录");
    }
    return store.saveProject(parsed);
  });
  handle("projects:choose-directory", async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: "选择项目本地目录",
      properties: ["openDirectory"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handle("sessions:list", (workspaceId) => {
    store.importLegacyActivity(idSchema.parse(workspaceId));
    return store.sessions();
  });
  handle("sessions:create", (workspaceId, serverId, engine, projectId) =>
    store.createSession(
      idSchema.parse(workspaceId),
      serverId === undefined ? undefined : idSchema.parse(serverId),
      z.enum(["builtin", "codex", "claude"]).default("builtin").parse(engine),
      projectId === undefined ? undefined : idSchema.parse(projectId),
    ),
  );
  handle("sessions:ensure", (workspaceId) =>
    store.ensureSession(idSchema.parse(workspaceId)),
  );
  handle("sessions:context-menu", (id) => {
    const parsedId = idSchema.parse(id);
    store.session(parsedId);
    return new Promise<"delete" | undefined>((resolve) => {
      const menu = Menu.buildFromTemplate([
        {
          label: "删除 Session",
          enabled:
            !sessionTasks.has(parsedId) && !sessionExecutions.has(parsedId),
          click: () => resolve("delete"),
        },
      ]);
      menu.popup({ window: window!, callback: () => resolve(undefined) });
    });
  });
  handle("sessions:remove", async (id) => {
    const parsedId = idSchema.parse(id);
    const owner = store.session(parsedId);
    const checkIdle = () => {
      if (sessionTasks.has(parsedId) || sessionExecutions.has(parsedId))
        throw new Error("Session 正在运行任务或命令，请结束后再删除");
    };
    checkIdle();
    const answer = await dialog.showMessageBox(window!, {
      type: "warning",
      title: "删除 Session",
      message: `删除“${owner.title}”？`,
      detail:
        "将删除此 Session 的对话、交接记录及执行记录。项目、服务器、文件和原生 CLI 历史保留。此操作无法撤销。",
      buttons: ["取消", "删除"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return false;
    checkIdle();
    store.removeSession(parsedId);
    approvals.revokeSession(parsedId);
    return true;
  });
  handle("sessions:update", (id, patch) => {
    const parsedId = idSchema.parse(id),
      parsed = sessionPatchSchema.parse(patch);
    if (
      (parsed.projectId !== undefined ||
        parsed.serverId !== undefined ||
        parsed.permissions !== undefined) &&
      (sessionTasks.has(parsedId) || sessionExecutions.has(parsedId))
    )
      throw new Error(
        "任务运行时不能更改项目、处理位置或权限策略，请先停止当前任务",
      );
    return store.updateSession(parsedId, parsed);
  });
  handle("servers:save", async (input) => {
    const parsed = serverSchema.parse(input);
    if (parsed.id) {
      store.server(parsed.id);
      ssh.disconnect(parsed.id);
      approvals.revokeServer(parsed.id);
    }
    return store.saveServer(parsed);
  });
  handle("servers:remove", (id) => {
    idSchema.parse(id);
    ssh.disconnect(id);
    approvals.revokeServer(id);
    store.removeServer(id);
  });
  handle("servers:connect", (id) => ssh.connect(idSchema.parse(id)));
  handle("servers:connected", () => ssh.connectedIds());
  handle("servers:disconnect", (id) => {
    idSchema.parse(id);
    approvals.revokeServer(id);
    ssh.disconnect(id);
  });
  handle("terminal:open", (id, sessionId) => {
    if (sessionId !== undefined) store.session(idSchema.parse(sessionId));
    if (sessionId && id) store.checkProjectTarget(sessionId, id);
    return id === undefined
      ? terminals.open(undefined, [], store.sessionDirectory(sessionId))
      : ssh.openTerminal(idSchema.parse(id));
  });
  handle("terminal:write", (id, data) => {
    idSchema.parse(id);
    z.string().max(65536).parse(data);
    return terminals.has(id) ? terminals.write(id, data) : ssh.write(id, data);
  });
  handle("terminal:resize", (id, cols, rows) => {
    idSchema.parse(id);
    z.number().int().min(2).max(500).parse(cols);
    z.number().int().min(1).max(300).parse(rows);
    return terminals.has(id)
      ? terminals.resize(id, cols, rows)
      : ssh.resize(id, cols, rows);
  });
  handle("terminal:close", (id) => {
    idSchema.parse(id);
    terminals.has(id) ? terminals.close(id) : ssh.closeTerminal(id);
  });
  handle("terminal:launch", async (engine, selection, sessionId) => {
    if (sessionId !== undefined) store.session(idSchema.parse(sessionId));
    const cwd = store.sessionDirectory(sessionId);
    z.enum(["codex", "claude"]).parse(engine);
    const options = agentSelectionSchema.parse(selection ?? {});
    await agent.validateSelection({ engine, ...options });
    const executable = findExecutable(engine);
    if (!executable) throw new Error(`未安装 ${engine}`);
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
      if (sessionId)
        throw new Error("带 Session 权限的原生启动需要 CLI 的 .exe 版本");
      if (options.model || options.effort)
        throw new Error("带模型设置的原生终端需要 CLI 的 .exe 版本");
      const id = terminals.open(undefined, [], cwd);
      terminals.write(id, `${engine}\r`);
      return id;
    }
    return terminals.open(
      executable,
      cliArguments({
        engine,
        ...options,
        permissions: sessionId
          ? (store.session(sessionId).permissions ?? "ask")
          : "ask",
      }),
      cwd,
    );
  });
  handle("remote:propose", (id, command, sessionId, proposalKey) => {
    if (id !== undefined) store.server(idSchema.parse(id));
    if (sessionId !== undefined) {
      const owner = store.session(idSchema.parse(sessionId));
      if (owner.serverId !== id)
        throw new Error("命令目标与当前 Session 处理位置不一致");
      if (owner.permissions === "read-only")
        throw new Error("只读权限不能执行任意命令");
      store.checkProjectTarget(sessionId, id);
    }
    if (proposalKey !== undefined) z.string().max(100).parse(proposalKey);
    return approvals.propose(
      id,
      commandSchema.parse(command),
      sessionId,
      proposalKey,
      sessionId ? (store.session(sessionId).permissions ?? "ask") : "ask",
    );
  });
  handle("remote:execute", async (id) => {
    const { serverId, command, sessionId, proposalKey, permissions } =
      approvals.consume(idSchema.parse(id));
    if (sessionId)
      sessionExecutions.set(
        sessionId,
        (sessionExecutions.get(sessionId) ?? 0) + 1,
      );
    try {
      const server = serverId ? store.server(serverId) : undefined;
      const currentPermissions = sessionId
        ? (store.session(sessionId).permissions ?? "ask")
        : "ask";
      if (
        currentPermissions === "read-only" ||
        currentPermissions !== (permissions ?? "ask")
      )
        throw new Error("权限策略发生变化，请重新提交命令");
      if (sessionId && store.session(sessionId).serverId !== serverId)
        throw new Error("处理位置发生变化，请重新提交命令");
      if (sessionId) store.checkProjectTarget(sessionId, serverId);
      const snapshot = JSON.stringify({
        server,
        directory: store.sessionDirectory(sessionId),
      });
      if (currentPermissions !== "bypass") {
        const result = await dialog.showMessageBox(window!, {
          type: "warning",
          title: server ? "确认服务器执行" : "确认本机执行",
          message: `在 ${server?.name ?? "本机"} 执行命令？`,
          detail: `目标：${server ? `${server.username}@${server.host}:${server.port}` : `本机 · ${store.sessionDirectory(sessionId) ?? app.getPath("home")}`}\n\n${command}\n\n请检查所有参数及潜在影响。`,
          buttons: ["取消", "执行命令"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) throw new Error("用户取消执行");
      }
      if (
        JSON.stringify({
          server: serverId ? store.server(serverId) : undefined,
          directory: store.sessionDirectory(sessionId),
        }) !== snapshot
      )
        throw new Error("服务器配置发生变化，请重新审批");
      if (sessionId && store.session(sessionId).serverId !== serverId)
        throw new Error("处理位置发生变化，请重新提交命令");
      if (
        (sessionId
          ? (store.session(sessionId).permissions ?? "ask")
          : "ask") !== currentPermissions
      )
        throw new Error("权限策略发生变化，请重新提交命令");
      if (sessionId) store.checkProjectTarget(sessionId, serverId);
      if (!serverId)
        return await executeLocal(
          store,
          command,
          sessionId,
          proposalKey,
          currentPermissions === "bypass" ? "bypassed" : "confirmed",
        );
      return await ssh.execute(
        serverId,
        command,
        sessionId,
        proposalKey,
        currentPermissions === "bypass" ? "bypassed" : "confirmed",
      );
    } finally {
      if (sessionId) {
        const remaining = (sessionExecutions.get(sessionId) ?? 1) - 1;
        if (remaining) sessionExecutions.set(sessionId, remaining);
        else sessionExecutions.delete(sessionId);
      }
    }
  });
  handle("remote:files", (id, path) =>
    ssh.files(
      idSchema.parse(id),
      z
        .string()
        .min(1)
        .max(4096)
        .refine((v) => !v.includes("\0"))
        .parse(path),
    ),
  );
  handle("agent:run", async (input) => {
    const parsed = agentSchema.parse(input);
    const sessionId = parsed.sessionId;
    if (!sessionId) return agent.run(parsed);
    const owner = store.session(sessionId);
    if (parsed.serverId !== owner.serverId)
      throw new Error("任务目标与当前 Session 处理位置不一致");
    if (store.sessionProject(sessionId)) {
      store.checkProjectTarget(sessionId, parsed.serverId);
    }
    if (sessionTasks.has(sessionId))
      throw new Error("此 Session 已有任务正在运行");
    sessionTasks.add(sessionId);
    try {
      store.appendMessage(sessionId, {
        id: parsed.userMessageId ?? randomUUID(),
        role: "user",
        text: parsed.message,
        serverId: parsed.serverId,
        engine: parsed.engine,
        targetKey: store.targetKey(parsed.serverId),
      });
      store.appendMessage(sessionId, {
        id: parsed.taskId,
        role: "assistant",
        text: "",
        serverId: parsed.serverId,
        status: "running",
        engine: parsed.engine,
        targetKey: store.targetKey(parsed.serverId),
      });
      try {
        const result = await agent.run(parsed);
        store.finishMessage(sessionId, parsed.taskId, {
          text: result.text,
          result,
          status: "completed",
        });
        return result;
      } catch (error) {
        store.finishMessage(sessionId, parsed.taskId, {
          text: error instanceof Error ? error.message : String(error),
          status: "error",
        });
        throw error;
      }
    } finally {
      sessionTasks.delete(sessionId);
    }
  });
  handle("agent:cancel", (id) => agent.cancel(idSchema.parse(id)));
  handle("agent:detect", () => agent.detect());
  handle("agent:models", (engine, refresh) =>
    agent.models(
      z.enum(["builtin", "codex", "claude"]).parse(engine),
      z.boolean().default(false).parse(refresh),
    ),
  );
  handle("agent:reset-native", (sessionId, engine, serverId, model) => {
    const id = idSchema.parse(sessionId);
    if (sessionTasks.has(id)) throw new Error("请先停止当前 Session 的任务");
    return store.resetNative(
      id,
      z.enum(["builtin", "codex", "claude"]).parse(engine),
      agent.scope(
        engine,
        serverId === undefined ? undefined : idSchema.parse(serverId),
        agentSelectionSchema.parse({ model }).model,
        id,
      ),
    );
  });
  handle("settings:get", () => store.settings());
  handle("settings:save", (input) =>
    store.saveSettings(settingsSchema.parse(input)),
  );
  handle("activity:list", (sessionId) => {
    if (sessionId !== undefined) store.session(idSchema.parse(sessionId));
    return store.activity(sessionId);
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 720,
    title: "AxonSSH",
    backgroundColor: "#101114",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    ssh.dispose();
    terminals.dispose();
    agent.dispose();
    approvals.clear();
    output.clear();
    window = undefined;
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}
app
  .whenReady()
  .then(async () => {
    store = await Store.open(join(app.getPath("userData"), "axonssh.sqlite"), {
      encrypt(value) {
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === "linux" &&
            safeStorage.getSelectedStorageBackend() === "basic_text")
        ) {
          throw new Error(
            "系统安全凭据存储不可用，请启用系统钥匙串，或使用 SSH Agent；不会明文保存密钥。",
          );
        }
        return safeStorage.encryptString(value).toString("base64");
      },
      decrypt(value) {
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      },
    });
    ssh = new SSHService(store, emit, async (host, fingerprint) => {
      const result = await dialog.showMessageBox(window!, {
        type: "warning",
        title: "首次连接：确认主机密钥",
        message: `信任 ${host} 的主机密钥？`,
        detail: `${fingerprint}\n\n请通过可信渠道核对指纹。确认后将固定此密钥，密钥变化会拒绝连接。`,
        buttons: ["取消", "信任并连接"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    });
    terminals = new LocalTerminals(emit);
    agent = new AgentService(store, emit, (input, signal) =>
      input.serverId
        ? ssh.diagnostics(input.serverId, signal)
        : Promise.resolve(localDiagnostics()),
    );
    registerIPC();
    createWindow();
    app.on("activate", () => {
      if (!window) createWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("AxonSSH 启动失败", String(error));
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (app.isReady()) electronSession.defaultSession.flushStorageData();
  ssh?.dispose();
  terminals?.dispose();
  agent?.dispose();
  if (outputTimer) clearTimeout(outputTimer);
});
