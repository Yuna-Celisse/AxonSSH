import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type {
  AppEvent,
  CommandResult,
  FileEntry,
  Diagnostics,
} from "../shared/types";
import type { Store } from "./store";

export class SSHService {
  private connections = new Map<string, Client>();
  private connecting = new Map<string, Promise<void>>();
  private pendingClients = new Map<string, Client>();
  private terminals = new Map<string, ClientChannel>();
  private busy = new Set<string>();
  constructor(
    private store: Store,
    private emit: (event: AppEvent) => void,
    private confirmHost: (
      host: string,
      fingerprint: string,
    ) => Promise<boolean>,
  ) {}
  async connect(id: string) {
    if (this.connections.has(id)) return;
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const promise = this.establish(id);
    this.connecting.set(id, promise);
    try {
      await promise;
    } finally {
      this.connecting.delete(id);
    }
  }
  private async establish(id: string) {
    const server = this.store.server(id);
    const secret = this.store.secret(id);
    const client = new Client();
    let acceptedFingerprint: string | undefined;
    let verificationError: string | undefined;
    const options: ConnectConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
        const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
        if (server.fingerprint) {
          if (server.fingerprint !== fingerprint)
            verificationError =
              "服务器主机密钥发生变化，连接已拒绝。请通过可信渠道核实后重新添加服务器。";
          callback(server.fingerprint === fingerprint);
        } else {
          void this.confirmHost(`${server.host}:${server.port}`, fingerprint)
            .then((accepted) => {
              if (accepted) acceptedFingerprint = fingerprint;
              callback(accepted);
            })
            .catch(() => callback(false));
        }
      },
    };
    if (server.authType === "password") options.password = secret ?? "";
    if (server.authType === "key") {
      const path = server.privateKeyPath!.replace(/^~(?=[/\\])/, homedir());
      options.privateKey = readFileSync(path);
      if (secret) options.passphrase = secret;
    }
    if (server.authType === "agent") {
      const agent =
        process.env.SSH_AUTH_SOCK ||
        (process.platform === "win32"
          ? "\\\\.\\pipe\\openssh-ssh-agent"
          : undefined);
      if (!agent) throw new Error("未发现 SSH Agent，请启动 agent 并添加密钥");
      options.agent = agent;
    }
    this.pendingClients.set(id, client);
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      client.on("error", (error) => {
        if (!ready) reject(new Error(verificationError ?? error.message));
      });
      client.once("close", () => {
        if (this.connections.get(id) === client) {
          this.connections.delete(id);
          this.emit({ type: "server:status", id, connected: false });
        }
        if (this.pendingClients.get(id) === client)
          this.pendingClients.delete(id);
        if (!ready)
          reject(new Error(verificationError ?? "SSH 连接在认证前关闭"));
      });
      client.once("ready", () => {
        try {
          if (acceptedFingerprint) this.store.pinHost(id, acceptedFingerprint);
          ready = true;
          this.pendingClients.delete(id);
          this.connections.set(id, client);
          this.emit({ type: "server:status", id, connected: true });
          resolve();
        } catch (error) {
          client.end();
          reject(error);
        }
      });
      client.connect(options);
    }).catch((error) => {
      client.destroy();
      throw error;
    });
  }
  private connection(id: string) {
    const client = this.connections.get(id);
    if (!client) throw new Error("SSH 已断开，请重新连接");
    return client;
  }
  connectedIds() {
    return [...this.connections.keys()];
  }
  async openTerminal(serverId: string) {
    await this.connect(serverId);
    return new Promise<string>((resolve, reject) => {
      this.connection(serverId).shell(
        { term: "xterm-256color", cols: 100, rows: 28 },
        (error, channel) => {
          if (error) return reject(error);
          const id = randomUUID();
          this.terminals.set(id, channel);
          channel.setEncoding("utf8");
          channel.on("data", (data: string) =>
            this.emit({ type: "terminal:data", id, data }),
          );
          channel.stderr.setEncoding("utf8");
          channel.stderr.on("data", (data: string) =>
            this.emit({ type: "terminal:data", id, data }),
          );
          channel.on("error", () => channel.destroy());
          channel.once("close", () => {
            this.terminals.delete(id);
            this.emit({
              type: "terminal:closed",
              id,
              reason: "SSH 会话已关闭",
            });
          });
          resolve(id);
        },
      );
    });
  }
  write(id: string, data: string) {
    const channel = this.terminals.get(id);
    if (!channel) throw new Error("终端已关闭");
    channel.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    this.terminals.get(id)?.setWindow(rows, cols, 0, 0);
  }
  closeTerminal(id: string) {
    this.terminals.get(id)?.close();
  }
  hasTerminal(id: string) {
    return this.terminals.has(id);
  }
  async execute(
    serverId: string,
    command: string,
    sessionId?: string,
    proposalKey?: string,
    approval?: "confirmed" | "bypassed",
  ): Promise<CommandResult> {
    if (this.busy.has(serverId))
      throw new Error("此服务器有命令正在执行，请等待完成");
    const targetKey = this.store.targetKey(serverId);
    this.busy.add(serverId);
    const started = Date.now();
    try {
      const result = await new Promise<CommandResult>((resolve, reject) => {
        this.connection(serverId).exec(command, (error, channel) => {
          if (error) return reject(error);
          let stdout = "",
            stderr = "",
            truncated = false,
            total = 0;
          let code: number | null = null;
          const collect = (target: "stdout" | "stderr", data: string) => {
            if (total >= 1024 * 1024) {
              truncated = true;
              return;
            }
            const part = data.slice(0, 1024 * 1024 - total);
            total += part.length;
            if (part.length < data.length) truncated = true;
            if (target === "stdout") stdout += part;
            else stderr += part;
          };
          const timer = setTimeout(() => {
            channel.close();
            reject(
              new Error(
                "命令超过 60 秒。关闭通道不保证远程进程已终止，请检查服务器；不会自动重试。",
              ),
            );
          }, 60000);
          channel.setEncoding("utf8");
          channel.stderr.setEncoding("utf8");
          channel.on("data", (d: string) => collect("stdout", d));
          channel.stderr.on("data", (d: string) => collect("stderr", d));
          channel.on("exit", (value: number) => {
            code = value;
          });
          channel.once("error", (e: Error) => {
            clearTimeout(timer);
            reject(e);
          });
          channel.once("close", () => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code, truncated });
          });
        });
      });
      this.store.record({
        id: randomUUID(),
        serverId,
        command,
        code: result.code,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        sessionId,
        targetKey,
        proposalKey,
        approval,
        result,
      });
      return result;
    } catch (error) {
      this.store.record({
        id: randomUUID(),
        serverId,
        command,
        code: null,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        sessionId,
        targetKey,
        proposalKey,
        approval,
      });
      throw error;
    } finally {
      this.busy.delete(serverId);
    }
  }
  async files(serverId: string, path: string): Promise<FileEntry[]> {
    return new Promise((resolve, reject) => {
      this.connection(serverId).sftp((error, sftp) => {
        if (error) return reject(error);
        sftp.readdir(path, (error, entries) => {
          sftp.end();
          if (error) return reject(error);
          resolve(
            entries
              .filter((e) => e.filename !== "." && e.filename !== "..")
              .map((e) => ({
                name: e.filename,
                size: e.attrs.size,
                directory: e.attrs.isDirectory(),
                modified: e.attrs.mtime,
              }))
              .sort(
                (a, b) =>
                  Number(b.directory) - Number(a.directory) ||
                  a.name.localeCompare(b.name),
              ),
          );
        });
      });
    });
  }
  async diagnostics(
    serverId: string,
    signal: AbortSignal,
  ): Promise<Diagnostics> {
    await this.connect(serverId);
    if (signal.aborted) throw new Error("诊断已取消");
    const sftp = await new Promise<import("ssh2").SFTPWrapper>(
      (resolve, reject) =>
        this.connection(serverId).sftp((error, value) =>
          error ? reject(error) : resolve(value),
        ),
    );
    const entries: Diagnostics["entries"] = [];
    sftp.on("error", () => {});
    try {
      for (const path of [
        "/etc/os-release",
        "/proc/loadavg",
        "/proc/meminfo",
        "/proc/uptime",
      ]) {
        if (signal.aborted) throw new Error("诊断已取消");
        try {
          const read = await new Promise<{ text: string; truncated: boolean }>(
            (resolve, reject) => {
              let handle: Buffer | undefined,
                completed = false,
                count = 0;
              const chunks: Buffer[] = [];
              const finish = (error?: Error, truncated = false) => {
                if (completed) return;
                completed = true;
                clearTimeout(timer);
                signal.removeEventListener("abort", abort);
                if (handle) sftp.close(handle, () => {});
                error
                  ? reject(error)
                  : resolve({
                      text: Buffer.concat(chunks).toString("utf8"),
                      truncated,
                    });
              };
              const abort = () => finish(new Error("诊断已取消"));
              const timer = setTimeout(
                () => finish(new Error("读取超时")),
                15000,
              );
              signal.addEventListener("abort", abort, { once: true });
              sftp.open(path, "r", (error, value) => {
                if (completed) {
                  if (value) sftp.close(value, () => {});
                  return;
                }
                if (error) return finish(error);
                handle = value;
                const next = () => {
                  if (completed) return;
                  const buffer = Buffer.alloc(Math.min(1024, 4096 - count));
                  sftp.read(
                    value,
                    buffer,
                    0,
                    buffer.length,
                    count,
                    (error, bytes) => {
                      if (completed) return;
                      if (error)
                        return (error as Error & { code?: number }).code === 1
                          ? finish()
                          : finish(error);
                      if (!bytes) return finish();
                      chunks.push(buffer.subarray(0, bytes));
                      count += bytes;
                      if (count >= 4096) return finish(undefined, true);
                      next();
                    },
                  );
                };
                next();
              });
            },
          );
          entries.push({ name: path, ...read });
        } catch (error) {
          if (signal.aborted) throw error;
          entries.push({
            name: path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { source: "sftp", collectedAt: new Date().toISOString(), entries };
    } finally {
      sftp.end();
    }
  }
  disconnect(id: string) {
    this.pendingClients.get(id)?.destroy();
    this.connections.get(id)?.end();
    this.connections.delete(id);
    this.emit({ type: "server:status", id, connected: false });
  }
  dispose() {
    for (const client of this.pendingClients.values()) client.destroy();
    this.pendingClients.clear();
    for (const channel of this.terminals.values()) channel.close();
    for (const client of this.connections.values()) client.end();
    this.connections.clear();
  }
}
