import { randomUUID } from "node:crypto";
export class Approvals {
  private pending = new Map<
    string,
    {
      serverId?: string;
      command: string;
      expires: number;
      sessionId?: string;
      proposalKey?: string;
      permissions?: string;
    }
  >();
  constructor(private now = () => Date.now()) {}
  propose(
    serverId: string | undefined,
    command: string,
    sessionId?: string,
    proposalKey?: string,
    permissions?: string,
  ) {
    for (const [id, request] of this.pending)
      if (request.expires <= this.now()) this.pending.delete(id);
    if (this.pending.size >= 100) throw new Error("待审批命令过多");
    const id = randomUUID();
    this.pending.set(id, {
      serverId,
      command,
      sessionId,
      proposalKey,
      permissions,
      expires: this.now() + 5 * 60 * 1000,
    });
    return id;
  }
  consume(id: string) {
    const request = this.pending.get(id);
    this.pending.delete(id);
    if (!request || request.expires <= this.now())
      throw new Error("审批已过期或已使用，请重新确认");
    return request;
  }
  revokeServer(serverId: string) {
    for (const [id, r] of this.pending)
      if (r.serverId === serverId) this.pending.delete(id);
  }
  revokeSession(sessionId: string) {
    for (const [id, r] of this.pending)
      if (r.sessionId === sessionId) this.pending.delete(id);
  }
  clear() {
    this.pending.clear();
  }
}
