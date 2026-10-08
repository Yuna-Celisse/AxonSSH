import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
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
} from "../shared/validation";
import type { AppEvent } from "../shared/types";

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
  handle("servers:disconnect", (id) => {
    idSchema.parse(id);
    approvals.revokeServer(id);
    ssh.disconnect(id);
  });
  handle("terminal:open", (id) =>
    id === undefined ? terminals.open() : ssh.openTerminal(idSchema.parse(id)),
  );
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
  handle("terminal:launch", (engine) => {
    z.enum(["codex", "claude"]).parse(engine);
    const executable = findExecutable(engine);
    if (!executable) throw new Error(`未安装 ${engine}`);
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
      const id = terminals.open();
      terminals.write(id, `${engine}\r`);
      return id;
    }
    return terminals.open(executable);
  });
  handle("remote:propose", (id, command) => {
    store.server(idSchema.parse(id));
    return approvals.propose(id, commandSchema.parse(command));
  });
  handle("remote:execute", async (id) => {
    const { serverId, command } = approvals.consume(idSchema.parse(id));
    const server = store.server(serverId);
    const snapshot = JSON.stringify(server);
    const result = await dialog.showMessageBox(window!, {
      type: "warning",
      title: "确认远程执行",
      message: `在 ${server.name} 执行命令？`,
      detail: `目标：${server.username}@${server.host}:${server.port}\n\n${command}\n\n命令通过独立 SSH 通道执行。请检查所有参数及潜在影响。`,
      buttons: ["取消", "执行命令"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) throw new Error("用户取消执行");
    if (JSON.stringify(store.server(serverId)) !== snapshot)
      throw new Error("服务器配置发生变化，请重新审批");
    return ssh.execute(serverId, command);
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
  handle("agent:run", (input) => agent.run(agentSchema.parse(input)));
  handle("agent:cancel", (id) => agent.cancel(idSchema.parse(id)));
  handle("agent:detect", () => agent.detect());
  handle("settings:get", () => store.settings());
  handle("settings:save", (input) =>
    store.saveSettings(settingsSchema.parse(input)),
  );
  handle("activity:list", () => store.activity());
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
    agent = new AgentService(store, emit);
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
  ssh?.dispose();
  terminals?.dispose();
  agent?.dispose();
  if (outputTimer) clearTimeout(outputTimer);
});
