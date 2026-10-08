import { describe, expect, it } from "vitest";
import { buildHandoff } from "../src/main/handoff";
import type {
  NativeSession,
  Session,
  SessionMessage,
  Activity,
} from "../src/shared/types";

const message = (
  id: string,
  engine: "codex" | "claude",
  text: string,
  targetKey = "local",
): SessionMessage => ({ id, engine, role: "user", text, targetKey });
const native: NativeSession = {
  key: "native-a",
  engine: "claude",
  scope: "local:default",
  nativeId: "existing-claude-id",
  messageCursor: 2,
  recordIds: ["known-operation"],
};
const session: Session = {
  id: "session",
  workspaceId: "workspace",
  title: "Diagnostic task",
  engine: "claude",
  createdAt: "now",
  updatedAt: "now",
  messages: [
    message("claude-1", "claude", "already seen"),
    message("claude-2", "claude", "already answered"),
    message("codex-1", "codex", "new evidence"),
    message("codex-2", "codex", "new conclusion"),
    message("current", "claude", "continue"),
    { id: "pending", role: "assistant", text: "", status: "running" },
  ],
};

describe("incremental handoff", () => {
  it("returns only records added since this engine last completed, and never includes raw command output", () => {
    const base: Activity = {
      id: "new-operation",
      serverId: "server",
      sessionId: session.id,
      command: "uptime",
      createdAt: "now",
      durationMs: 7,
      code: null,
      targetKey: "local",
      result: {
        stdout: "PRIVATE_RAW_OUTPUT",
        stderr: "",
        code: null,
        truncated: false,
      },
    };
    const handoff = buildHandoff(
      session,
      native,
      "local",
      [
        base,
        { ...base, id: "known-operation" },
        { ...base, id: "another-target", targetKey: "other-server" },
      ],
      "turn",
    );
    expect(handoff.resumed).toBe(true);
    expect(handoff.messageIds).toEqual(["codex-1", "codex-2"]);
    expect(handoff.recordIds).toEqual(["new-operation"]);
    expect(handoff.payload).not.toContain("already seen");
    expect(handoff.payload).not.toContain("PRIVATE_RAW_OUTPUT");
    expect(JSON.parse(handoff.payload).operations[0].status).toBe(
      "unknown_do_not_retry",
    );
    expect(handoff.payload).toContain("未完成审批不转移");
  });
  it("does not transfer another server's context or repeat the current question", () => {
    const isolated = {
      ...session,
      messages: [
        ...session.messages.slice(0, 2),
        message("different-server", "codex", "foreign context", "other-server"),
        ...session.messages.slice(-2),
      ],
    };
    const handoff = buildHandoff(isolated, native, "local", [], "turn");
    expect(handoff.messageIds).toEqual([]);
    expect(handoff.payload).not.toContain("foreign context");
    expect(handoff.payload).not.toContain('"text": "continue"');
  });
  it("labels bounded excerpts and preserves complete originals", () => {
    const original = "x".repeat(5000);
    const longSession = {
      ...session,
      messages: [
        message("long", "codex", original),
        ...session.messages.slice(-2),
      ],
    };
    const handoff = buildHandoff(
      longSession,
      { ...native, nativeId: undefined, messageCursor: 0 },
      "local",
      [],
      "turn",
    );
    expect(handoff.truncated).toBe(true);
    expect(handoff.payload.length).toBeLessThan(3000);
    expect(handoff.payload).toContain("中段省略");
    expect(longSession.messages[0].text).toBe(original);
  });
});
