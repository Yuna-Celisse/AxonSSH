import { describe, expect, it } from "vitest";
import { Approvals } from "../src/main/approvals";
describe("single-use command approvals", () => {
  it("binds the exact server and command, and cannot be replayed", () => {
    const approvals = new Approvals();
    const id = approvals.propose("server-a", "printf hello");
    expect(approvals.consume(id)).toMatchObject({
      serverId: "server-a",
      command: "printf hello",
    });
    expect(() => approvals.consume(id)).toThrow("已使用");
  });
  it("rejects expired approvals", () => {
    let now = 1;
    const approvals = new Approvals(() => now);
    const id = approvals.propose("server", "pwd");
    now += 300001;
    expect(() => approvals.consume(id)).toThrow("过期");
  });
  it("revokes pending actions when a server changes or disconnects", () => {
    const approvals = new Approvals();
    const id = approvals.propose("server", "pwd");
    approvals.revokeServer("server");
    expect(() => approvals.consume(id)).toThrow();
  });
});
