export type AuthType = "password" | "key" | "agent";
export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  group: string;
  authType: AuthType;
  privateKeyPath?: string;
  hasSecret: boolean;
  fingerprint?: string;
  jumpServerId?: string;
}
export interface ServerInput extends Omit<
  Server,
  "id" | "hasSecret" | "fingerprint"
> {
  id?: string;
  secret?: string;
  jumpServerId?: string;
}
export interface Settings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  provider?: "deepseek" | "compatible";
  reasoningEffort?: "none" | "low" | "high" | "max";
}
export type Engine = "builtin" | "codex" | "claude";
export type PermissionPolicy = "read-only" | "ask" | "accept-edits" | "bypass";
export interface Diagnostics {
  source: "local" | "sftp";
  collectedAt: string;
  entries: {
    name: string;
    text?: string;
    error?: string;
    truncated?: boolean;
  }[];
}
export interface AgentSelection {
  model?: string;
  effort?: string;
}
export interface ModelCatalog {
  models: {
    id: string;
    name: string;
    description?: string;
    efforts: string[];
    defaultEffort?: string;
  }[];
  error?: string;
}
export interface AgentInput {
  taskId: string;
  engine: Engine;
  message: string;
  serverId?: string;
  sessionId?: string;
  userMessageId?: string;
  model?: string;
  effort?: string;
  diagnostics?: Diagnostics;
  permissions?: PermissionPolicy;
}
export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  serverId?: string;
  result?: AgentResult;
  status?: "running" | "completed" | "interrupted" | "error";
  engine?: Engine;
  targetKey?: string;
}
export interface NativeSession {
  key: string;
  engine: Engine;
  scope: string;
  nativeId?: string;
  messageCursor: number;
  recordIds: string[];
  pending?: boolean;
  unavailable?: boolean;
  retired?: boolean;
  apiMessages?: { role: "system" | "user" | "assistant"; content: string }[];
}
export interface Handoff {
  id: string;
  engine: Engine;
  nativeKey: string;
  resumed: boolean;
  payload: string;
  messageIds: string[];
  recordIds: string[];
  truncated: boolean;
  createdAt: string;
  status: "running" | "completed" | "error" | "interrupted";
  error?: string;
  usage?: {
    inputTokens?: number;
    cachedTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
  };
}
export interface Session {
  id: string;
  workspaceId: string;
  projectId?: string;
  title: string;
  serverId?: string;
  engine: Engine;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  agentOptions?: Partial<Record<Engine, AgentSelection>>;
  nativeSessions?: NativeSession[];
  handoffs?: Handoff[];
  permissions?: PermissionPolicy;
}
/**
 * Session title and project membership are managed from the native Session
 * menu, so the menu reports the choice and the renderer applies it through
 * `sessions.update` — the single place that rejects changes while a task runs.
 */
export type SessionMenuAction =
  | { action: "rename" }
  | { action: "move"; projectId: string | null }
  | { action: "delete" };
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  directory?: string;
  archived: boolean;
  includeLocal: boolean;
  serverIds: string[];
  remoteDirectory?: string;
}
export interface Proposal {
  command: string;
  explanation: string;
}
export interface AgentResult {
  text: string;
  proposals: Proposal[];
  diagnostics?: Diagnostics;
  nativeToolCalls?: number;
  permissionDenials?: number;
}
export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  truncated: boolean;
}
export interface FileEntry {
  name: string;
  size: number;
  directory: boolean;
  modified: number;
}
export interface Activity {
  id: string;
  serverId?: string;
  kind?: "command" | "diagnostic";
  diagnostics?: Diagnostics;
  approval?: "confirmed" | "bypassed";
  command: string;
  code: number | null;
  createdAt: string;
  durationMs: number;
  sessionId?: string;
  proposalKey?: string;
  result?: CommandResult;
  targetKey?: string;
}
export type AppEvent =
  | { type: "server:status"; id: string; connected: boolean }
  | { type: "terminal:data"; id: string; data: string }
  | { type: "terminal:closed"; id: string; reason: string }
  | { type: "agent:delta"; id: string; data: string };
export interface CliInfo {
  engine: "codex" | "claude";
  installed: boolean;
  path?: string;
}
export interface AxonAPI {
  projects: {
    list(): Promise<Project[]>;
    save(input: {
      id?: string;
      workspaceId: string;
      name: string;
      directory?: string;
      archived?: boolean;
      includeLocal?: boolean;
      serverIds?: string[];
      remoteDirectory?: string;
    }): Promise<Project>;
    chooseDirectory(): Promise<string | undefined>;
  };
  sessions: {
    contextMenu(
      id: string,
      options?: { projects: { id: string; name: string }[] },
    ): Promise<SessionMenuAction | undefined>;
    remove(id: string): Promise<boolean>;
    list(legacyWorkspaceId: string): Promise<Session[]>;
    create(
      workspaceId: string,
      serverId?: string,
      engine?: Engine,
      projectId?: string,
    ): Promise<Session>;
    ensure(workspaceId: string): Promise<Session>;
    update(
      id: string,
      patch: {
        title?: string;
        serverId?: string | null;
        engine?: Engine;
        agentOptions?: Partial<Record<Engine, AgentSelection>>;
        projectId?: string | null;
        permissions?: PermissionPolicy;
      },
    ): Promise<Session>;
  };
  servers: {
    connected(): Promise<string[]>;
    list(): Promise<Server[]>;
    save(input: ServerInput): Promise<Server>;
    remove(id: string): Promise<void>;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    importOpenSshConfig(): Promise<{
      imported: Server[];
      count: number;
      skipped: { alias: string; reason: string }[];
    }>;
    contextMenu(
      id: string,
      options?: { isConnected?: boolean },
    ): Promise<
      | "connect"
      | "disconnect"
      | "open-terminal"
      | "open-files"
      | "edit"
      | "copy-ssh-command"
      | "delete"
      | undefined
    >;
  };
  terminal: {
    open(serverId?: string, sessionId?: string): Promise<string>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    close(id: string): Promise<void>;
    launch(
      engine: "codex" | "claude",
      selection?: AgentSelection,
      sessionId?: string,
    ): Promise<string>;
  };
  remote: {
    propose(
      serverId: string | undefined,
      command: string,
      sessionId?: string,
      proposalKey?: string,
    ): Promise<string>;
    execute(approvalId: string): Promise<CommandResult>;
    files(serverId: string, path: string): Promise<FileEntry[]>;
  };
  agent: {
    run(input: AgentInput): Promise<AgentResult>;
    cancel(id: string): Promise<void>;
    detect(): Promise<CliInfo[]>;
    models(engine: Engine, refresh?: boolean): Promise<ModelCatalog>;
    resetNative(
      sessionId: string,
      engine: Engine,
      serverId?: string,
      model?: string,
    ): Promise<Session>;
  };
  settings: {
    get(): Promise<Settings>;
    save(input: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      provider?: Settings["provider"];
      reasoningEffort?: Settings["reasoningEffort"];
    }): Promise<Settings>;
  };
  activity: { list(sessionId?: string): Promise<Activity[]> };
  onEvent(callback: (event: AppEvent) => void): () => void;
}
