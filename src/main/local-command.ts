import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { CommandResult } from "../shared/types";
import type { Store } from "./store";

export async function executeLocal(
  store: Store,
  command: string,
  sessionId?: string,
  proposalKey?: string,
  approval?: "confirmed" | "bypassed",
): Promise<CommandResult> {
  const started = Date.now();
  const result = await new Promise<CommandResult>((resolve) => {
    exec(
      command,
      {
        cwd: store.sessionDirectory(sessionId) ?? homedir(),
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr:
            stderr +
            (error && typeof error.code !== "number"
              ? `\n${error.message}`
              : ""),
          code: error
            ? typeof error.code === "number"
              ? error.code
              : null
            : 0,
          truncated:
            String(error?.code) === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    );
  });
  store.record({
    id: randomUUID(),
    sessionId,
    targetKey: "local",
    proposalKey,
    approval,
    command,
    code: result.code,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    result,
  });
  return result;
}
