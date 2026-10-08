import { describe, expect, it } from "vitest";
import { cliArguments, permissionArguments } from "../src/main/cli";

describe("native CLI permission mapping", () => {
  it("maps native interactive sandbox and approval controls without enabling bypass by default", () => {
    expect(permissionArguments("codex", "ask", true)).toEqual([
      "--sandbox",
      "workspace-write",
      "-a",
      "on-request",
    ]);
    expect(permissionArguments("codex", "read-only", true)).toEqual([
      "--sandbox",
      "read-only",
      "-a",
      "never",
    ]);
    expect(permissionArguments("claude", "ask", true)).toEqual([
      "--permission-mode",
      "default",
    ]);
    expect(permissionArguments("claude", "accept-edits", true)).toEqual([
      "--permission-mode",
      "acceptEdits",
    ]);
    expect(cliArguments({ engine: "codex" })).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
  });
  it("applies local permissions and keeps server analysis tools restricted with exact resume IDs", () => {
    const resumed = cliArguments(
      { engine: "codex", permissions: "bypass" },
      "task",
      "saved-thread",
    );
    expect(resumed).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(resumed).toContain("saved-thread");
    expect(resumed).not.toContain("--last");
    const plan = cliArguments(
      { engine: "codex", serverId: "server", permissions: "bypass" },
      "task",
    );
    expect(plan).toContain("read-only");
    expect(plan).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const claude = cliArguments(
      { engine: "claude", permissions: "bypass" },
      "task",
    );
    expect(claude).toContain("bypassPermissions");
    expect(claude).toContain("--dangerously-skip-permissions");
    expect(claude).not.toContain("--tools");
    expect(
      cliArguments(
        { engine: "claude", serverId: "server", permissions: "bypass" },
        "task",
      ),
    ).toContain("--tools");
  });
});
