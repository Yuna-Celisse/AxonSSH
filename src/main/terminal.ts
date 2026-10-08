import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { AppEvent } from "../shared/types";
export class LocalTerminals {
  private sessions = new Map<string, pty.IPty>();
  constructor(private emit: (event: AppEvent) => void) {}
  open(executable?: string, args: string[] = [], cwd?: string) {
    const id = randomUUID();
    const shell =
      executable ??
      (process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/bash");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    const processPty = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: cwd ?? homedir(),
      env,
    });
    this.sessions.set(id, processPty);
    processPty.onData((data) => this.emit({ type: "terminal:data", id, data }));
    processPty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.emit({
        type: "terminal:closed",
        id,
        reason: `本地进程退出 (${exitCode})`,
      });
    });
    return id;
  }
  write(id: string, data: string) {
    const terminal = this.sessions.get(id);
    if (!terminal) throw new Error("终端已关闭");
    terminal.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.resize(cols, rows);
  }
  close(id: string) {
    this.sessions.get(id)?.kill();
  }
  has(id: string) {
    return this.sessions.has(id);
  }
  dispose() {
    for (const terminal of this.sessions.values()) terminal.kill();
    this.sessions.clear();
  }
}
