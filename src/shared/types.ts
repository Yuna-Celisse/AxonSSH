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
}
export interface ServerInput extends Omit<
  Server,
  "id" | "hasSecret" | "fingerprint"
> {
  id?: string;
  secret?: string;
}
export interface Settings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
export type Engine = "builtin" | "codex" | "claude";
export interface AgentInput {
  taskId: string;
  engine: Engine;
  message: string;
  serverId?: string;
}
export interface Proposal {
  command: string;
  explanation: string;
}
export interface AgentResult {
  text: string;
  proposals: Proposal[];
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
  serverId: string;
  command: string;
  code: number | null;
  createdAt: string;
  durationMs: number;
}
export type AppEvent =
  | { type: "terminal:data"; id: string; data: string }
  | { type: "terminal:closed"; id: string; reason: string }
  | { type: "agent:delta"; id: string; data: string };
export interface CliInfo {
  engine: "codex" | "claude";
  installed: boolean;
  path?: string;
}
export interface AxonAPI {
  servers: {
    list(): Promise<Server[]>;
    save(input: ServerInput): Promise<Server>;
    remove(id: string): Promise<void>;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
  };
  terminal: {
    open(serverId?: string): Promise<string>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    close(id: string): Promise<void>;
    launch(engine: "codex" | "claude"): Promise<string>;
  };
  remote: {
    propose(serverId: string, command: string): Promise<string>;
    execute(approvalId: string): Promise<CommandResult>;
    files(serverId: string, path: string): Promise<FileEntry[]>;
  };
  agent: {
    run(input: AgentInput): Promise<AgentResult>;
    cancel(id: string): Promise<void>;
    detect(): Promise<CliInfo[]>;
  };
  settings: {
    get(): Promise<Settings>;
    save(input: {
      baseUrl: string;
      model: string;
      apiKey?: string;
    }): Promise<Settings>;
  };
  activity: { list(): Promise<Activity[]> };
  onEvent(callback: (event: AppEvent) => void): () => void;
}
