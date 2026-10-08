import initSqlJs, { type Database } from "sql.js";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import type {
  Activity,
  Server,
  ServerInput,
  Settings,
  Session,
  SessionMessage,
  Engine,
  NativeSession,
  Handoff,
  Project,
} from "../shared/types";

export interface Vault {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
export class Store {
  private constructor(
    private db: Database,
    private path: string,
    private vault: Vault,
  ) {}
  static async open(path: string, vault: Vault) {
    const require = createRequire(
      typeof __filename !== "undefined" ? __filename : import.meta.url,
    );
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const db = new SQL.Database(
      existsSync(path) ? readFileSync(path) : undefined,
    );
    db.run(`CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, config TEXT NOT NULL, secret TEXT);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, config TEXT NOT NULL, secret TEXT);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, record TEXT NOT NULL);`);
    if (
      !db
        .exec("PRAGMA table_info(activity)")[0]
        .values.some((row) => row[1] === "session_id")
    )
      db.run("ALTER TABLE activity ADD COLUMN session_id TEXT");
    const store = new Store(db, path, vault);
    for (const session of store.sessions()) {
      if (
        session.messages.some((m) => m.status === "running") ||
        session.nativeSessions?.some((n) => n.pending) ||
        session.handoffs?.some((h) => h.status === "running")
      ) {
        session.messages = session.messages.map((m) =>
          m.status === "running"
            ? {
                ...m,
                status: "interrupted",
                text: m.text || "任务因应用退出而中断，可发送新消息继续。",
              }
            : m,
        );
        session.nativeSessions = session.nativeSessions?.map((n) =>
          n.pending ? { ...n, pending: false, unavailable: true } : n,
        );
        session.handoffs = session.handoffs?.map((h) =>
          h.status === "running"
            ? { ...h, status: "interrupted", error: "应用退出，未自动重试交接" }
            : h,
        );
        store.saveSession(session);
      }
    }
    return store;
  }
  private rows(sql: string, params: (string | number | null)[] = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  private flush() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, this.db.export(), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
  listServers(): Server[] {
    return this.rows("SELECT config, secret FROM servers").map((r) => ({
      ...JSON.parse(String(r.config)),
      hasSecret: !!r.secret,
    }));
  }
  server(id: string) {
    const value = this.listServers().find((s) => s.id === id);
    if (!value) throw new Error("服务器不存在");
    return value;
  }
  secret(id: string) {
    const row = this.rows("SELECT secret FROM servers WHERE id = ?", [id])[0];
    return row?.secret ? this.vault.decrypt(String(row.secret)) : undefined;
  }
  saveServer(input: ServerInput): Server {
    const { secret, ...config } = input;
    const id = input.id ?? randomUUID();
    const existing = this.rows(
      "SELECT config, secret FROM servers WHERE id = ?",
      [id],
    )[0];
    const previous = existing ? JSON.parse(String(existing.config)) : undefined;
    const sameCredential =
      previous &&
      previous.host === config.host &&
      previous.port === config.port &&
      previous.username === config.username &&
      previous.authType === config.authType &&
      previous.privateKeyPath === config.privateKeyPath;
    const storedSecret =
      secret !== undefined
        ? secret
          ? this.vault.encrypt(secret)
          : null
        : sameCredential
          ? (existing?.secret ?? null)
          : null;
    const fingerprint =
      previous?.host === config.host && previous?.port === config.port
        ? previous.fingerprint
        : undefined;
    this.db.run("INSERT OR REPLACE INTO servers VALUES (?, ?, ?)", [
      id,
      JSON.stringify({ ...config, id, fingerprint }),
      storedSecret as string | null,
    ]);
    this.flush();
    return this.server(id);
  }
  pinHost(id: string, fingerprint: string) {
    const { hasSecret: _, ...server } = this.server(id);
    this.db.run("UPDATE servers SET config = ? WHERE id = ?", [
      JSON.stringify({ ...server, fingerprint }),
      id,
    ]);
    this.flush();
  }
  removeServer(id: string) {
    this.db.run("DELETE FROM servers WHERE id = ?", [id]);
    this.flush();
  }
  settings(): Settings {
    const row = this.rows(
      "SELECT config, secret FROM settings WHERE id = 1",
    )[0];
    return row
      ? {
          provider: "compatible",
          reasoningEffort: "none",
          ...JSON.parse(String(row.config)),
          hasApiKey: !!row.secret,
        }
      : {
          provider: "deepseek",
          reasoningEffort: "none",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-flash",
          hasApiKey: false,
        };
  }
  apiKey() {
    const row = this.rows("SELECT secret FROM settings WHERE id = 1")[0];
    return row?.secret ? this.vault.decrypt(String(row.secret)) : undefined;
  }
  saveSettings(input: {
    baseUrl: string;
    model: string;
    apiKey?: string;
    provider?: Settings["provider"];
    reasoningEffort?: Settings["reasoningEffort"];
  }) {
    const { apiKey, ...config } = input;
    const row = this.rows(
      "SELECT config, secret FROM settings WHERE id = 1",
    )[0];
    const oldBase = row ? JSON.parse(String(row.config)).baseUrl : undefined;
    const sameOrigin =
      oldBase && new URL(oldBase).origin === new URL(config.baseUrl).origin;
    const secret =
      apiKey === undefined
        ? sameOrigin
          ? (row?.secret ?? null)
          : null
        : apiKey
          ? this.vault.encrypt(apiKey)
          : null;
    this.db.run("INSERT OR REPLACE INTO settings VALUES (1, ?, ?)", [
      JSON.stringify(config),
      secret as string | null,
    ]);
    this.flush();
    return this.settings();
  }
  record(activity: Activity) {
    this.db.run(
      "INSERT INTO activity (id, record, session_id) VALUES (?, ?, ?)",
      [activity.id, JSON.stringify(activity), activity.sessionId ?? null],
    );
    this.db.run(
      "DELETE FROM activity WHERE session_id IS ? AND rowid NOT IN (SELECT rowid FROM activity WHERE session_id IS ? ORDER BY rowid DESC LIMIT 1000)",
      [activity.sessionId ?? null, activity.sessionId ?? null],
    );
    this.flush();
  }
  activity(sessionId?: string): Activity[] {
    return this.rows(
      sessionId
        ? "SELECT record FROM activity WHERE session_id = ? ORDER BY rowid DESC LIMIT 1000"
        : "SELECT record FROM activity ORDER BY rowid DESC LIMIT 100",
      sessionId ? [sessionId] : [],
    ).map((r) => JSON.parse(String(r.record)));
  }
  sessions(): Session[] {
    return this.rows("SELECT record FROM sessions ORDER BY rowid DESC").map(
      (r) => JSON.parse(String(r.record)),
    );
  }
  session(id: string): Session {
    const row = this.rows("SELECT record FROM sessions WHERE id = ?", [id])[0];
    if (!row) throw new Error("Session 不存在");
    return JSON.parse(String(row.record));
  }
  removeSession(id: string) {
    this.session(id);
    this.db.run("BEGIN TRANSACTION");
    try {
      this.db.run("DELETE FROM activity WHERE session_id = ?", [id]);
      this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
    this.flush();
  }
  private projectRecord(record: string): Project {
    const { kind, ...project } = JSON.parse(record);
    return { includeLocal: kind !== "remote", serverIds: [], ...project };
  }
  projects(): Project[] {
    return this.rows("SELECT record FROM projects ORDER BY rowid DESC").map(
      (r) => this.projectRecord(String(r.record)),
    );
  }
  project(id: string): Project {
    const row = this.rows("SELECT record FROM projects WHERE id = ?", [id])[0];
    if (!row) throw new Error("项目不存在");
    return this.projectRecord(String(row.record));
  }
  normalizeDirectory(directory?: string) {
    if (!directory?.trim()) return undefined;
    const path = resolve(directory.replace(/^~(?=[/\\]|$)/, homedir()));
    if (!statSync(path).isDirectory())
      throw new Error("项目路径必须是已存在的本地文件夹");
    return realpathSync(path);
  }
  saveProject(input: {
    id?: string;
    workspaceId: string;
    name: string;
    directory?: string;
    archived?: boolean;
    includeLocal?: boolean;
    kind?: "local" | "remote";
    serverIds?: string[];
    remoteDirectory?: string;
  }): Project {
    const existing = input.id ? this.project(input.id) : undefined;
    if (existing && existing.workspaceId !== input.workspaceId)
      throw new Error("项目不能跨工作空间移动");
    const includeLocal =
      input.includeLocal ?? existing?.includeLocal ?? input.kind !== "remote";
    const serverIds = [
      ...new Set(input.serverIds ?? existing?.serverIds ?? []),
    ];
    if (!includeLocal && !serverIds.length)
      throw new Error("项目至少需要关联本地或一台服务器");
    for (const id of serverIds) this.server(id);
    const project: Project = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      includeLocal,
      serverIds,
      directory:
        input.directory === undefined
          ? existing?.directory
          : this.normalizeDirectory(input.directory),
      remoteDirectory:
        input.remoteDirectory === undefined
          ? existing?.remoteDirectory
          : input.remoteDirectory || undefined,
      archived: input.archived ?? existing?.archived ?? false,
    };
    this.db.run("INSERT OR REPLACE INTO projects VALUES (?, ?, ?)", [
      project.id,
      project.workspaceId,
      JSON.stringify(project),
    ]);
    this.flush();
    return project;
  }
  sessionProject(sessionId?: string) {
    const session = sessionId ? this.session(sessionId) : undefined;
    return session?.projectId ? this.project(session.projectId) : undefined;
  }
  sessionDirectory(sessionId?: string) {
    return this.normalizeDirectory(this.sessionProject(sessionId)?.directory);
  }
  checkProjectTarget(sessionId: string, serverId?: string) {
    const project = this.sessionProject(sessionId);
    if (project && serverId && !project.serverIds.includes(serverId))
      throw new Error("请在项目关联位置中选择任务目标");
    if (serverId) this.server(serverId);
  }
  targetKey(serverId?: string) {
    if (!serverId) return "local";
    const server = this.server(serverId);
    return createHash("sha256")
      .update(
        JSON.stringify({
          id: serverId,
          host: server.host,
          port: server.port,
          username: server.username,
        }),
      )
      .digest("hex");
  }
  nativeScope(serverId?: string, model?: string) {
    return `${this.targetKey(serverId)}:${model ?? "default"}`;
  }
  nativeSession(id: string, engine: Engine, scope: string) {
    return this.session(id).nativeSessions?.find(
      (n) => n.engine === engine && n.scope === scope && !n.retired,
    );
  }
  writeNative(id: string, native: NativeSession) {
    const session = this.session(id);
    session.nativeSessions = [
      ...(session.nativeSessions ?? []).filter((n) => n.key !== native.key),
      native,
    ];
    return this.saveSession(session);
  }
  resetNative(id: string, engine: Engine, scope: string) {
    const session = this.session(id);
    session.nativeSessions = session.nativeSessions?.map((n) =>
      n.engine === engine && n.scope === scope ? { ...n, retired: true } : n,
    );
    return this.saveSession(session);
  }
  recordHandoff(id: string, handoff: Handoff) {
    const session = this.session(id);
    session.handoffs = [
      ...(session.handoffs ?? []).filter((h) => h.id !== handoff.id),
      handoff,
    ];
    return this.saveSession(session);
  }
  private saveSession(session: Session) {
    this.db.run("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)", [
      session.id,
      session.workspaceId,
      JSON.stringify(session),
    ]);
    this.flush();
    return session;
  }
  createSession(
    workspaceId: string,
    serverId?: string,
    engine: Engine = "builtin",
    projectId?: string,
  ): Session {
    if (serverId) this.server(serverId);
    if (projectId) {
      const project = this.project(projectId);
      if (project.workspaceId !== workspaceId || project.archived)
        throw new Error("请选择当前工作空间中未归档的项目");
      if (serverId && !project.serverIds.includes(serverId))
        throw new Error("服务器不属于此项目");
    }
    const now = new Date().toISOString();
    return this.saveSession({
      id: randomUUID(),
      workspaceId,
      projectId,
      title: "新会话",
      serverId,
      engine,
      createdAt: now,
      updatedAt: now,
      messages: [],
    });
  }
  ensureSession(workspaceId: string) {
    return (
      this.sessions().find((s) => s.workspaceId === workspaceId) ??
      this.createSession(workspaceId)
    );
  }
  updateSession(
    id: string,
    patch: {
      title?: string;
      serverId?: string | null;
      engine?: Engine;
      agentOptions?: Session["agentOptions"];
      projectId?: string | null;
      permissions?: Session["permissions"];
    },
  ) {
    if (patch.serverId) this.server(patch.serverId);
    const session = this.session(id);
    if (patch.projectId) {
      const project = this.project(patch.projectId);
      if (project.workspaceId !== session.workspaceId || project.archived)
        throw new Error("请选择当前工作空间中未归档的项目");
    }
    const projectId =
      patch.projectId === null
        ? undefined
        : (patch.projectId ?? session.projectId);
    let serverId =
      patch.serverId === null
        ? undefined
        : (patch.serverId ?? session.serverId);
    const project = projectId ? this.project(projectId) : undefined;
    if (
      project &&
      (serverId ? !project.serverIds.includes(serverId) : !project.includeLocal)
    ) {
      if (patch.serverId !== undefined && patch.projectId === undefined)
        throw new Error("请在项目关联位置中选择任务目标");
      serverId = undefined;
    }
    return this.saveSession({
      ...session,
      ...patch,
      projectId,
      serverId,
      updatedAt: new Date().toISOString(),
    });
  }
  appendMessage(id: string, message: SessionMessage) {
    const session = this.session(id);
    if (session.title === "新会话" && message.role === "user")
      session.title = message.text.replace(/\s+/g, " ").slice(0, 40);
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
    return this.saveSession(session);
  }
  finishMessage(id: string, messageId: string, patch: Partial<SessionMessage>) {
    const session = this.session(id);
    session.messages = session.messages.map((m) =>
      m.id === messageId ? { ...m, ...patch } : m,
    );
    session.updatedAt = new Date().toISOString();
    return this.saveSession(session);
  }
  importLegacyActivity(workspaceId: string) {
    const rows = this.rows(
      "SELECT record FROM activity WHERE session_id IS NULL",
    );
    if (!rows.length) return;
    const session = this.createSession(workspaceId);
    this.updateSession(session.id, { title: "历史执行记录" });
    for (const row of rows) {
      const record: Activity = JSON.parse(String(row.record));
      record.sessionId = session.id;
      this.db.run(
        "UPDATE activity SET record = ?, session_id = ? WHERE id = ?",
        [JSON.stringify(record), session.id, record.id],
      );
    }
    this.flush();
  }
  close() {
    this.db.close();
  }
}
