import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/main/store";
import { AgentService } from "../src/main/agent";
const dirs: string[] = [];
const vault = {
  encrypt: (v: string) => `cipher:${Buffer.from(v).toString("base64")}`,
  decrypt: (v: string) => Buffer.from(v.slice(7), "base64").toString(),
};
const input = {
  name: "test",
  host: "example.com",
  username: "user",
  port: 22,
  group: "test",
  authType: "password" as const,
};
async function open() {
  const dir = mkdtempSync(join(tmpdir(), "axon-test-"));
  dirs.push(dir);
  const path = join(dir, "test.sqlite");
  return { store: await Store.open(path, vault), path };
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
describe("local SQLite and credential separation", () => {
  it("deletes only the selected Session and its activity durably", async () => {
    const { store, path } = await open();
    const workspaceId = randomUUID();
    const removed = store.createSession(workspaceId);
    const retained = store.createSession(workspaceId);
    store.record({
      id: randomUUID(),
      sessionId: removed.id,
      kind: "command",
      serverId: "host",
      command: "uptime",
      code: 0,
      durationMs: 1,
      createdAt: new Date().toISOString(),
    });
    store.record({
      id: randomUUID(),
      sessionId: retained.id,
      kind: "command",
      serverId: "host",
      command: "date",
      code: 0,
      durationMs: 1,
      createdAt: new Date().toISOString(),
    });
    store.removeSession(removed.id);
    const reopened = await Store.open(path, vault);
    expect(() => reopened.session(removed.id)).toThrow("Session 不存在");
    expect(reopened.activity(removed.id)).toEqual([]);
    expect(reopened.session(retained.id).id).toBe(retained.id);
    expect(reopened.activity(retained.id)).toHaveLength(1);
  });
  it("keeps a local directory and multiple server associations in the same project", async () => {
    const { store, path } = await open();
    const workspaceId = randomUUID();
    const a = store.saveServer({ ...input, name: "Mixed Alpha" });
    const b = store.saveServer({
      ...input,
      name: "Mixed Beta",
      host: "beta.test",
    });
    const project = store.saveProject({
      workspaceId,
      name: "Mixed project",
      includeLocal: true,
      directory: join(path, ".."),
      serverIds: [a.id, b.id],
      remoteDirectory: "/srv/service",
    });
    expect(project.directory).toBeTruthy();
    expect(project.serverIds).toEqual([a.id, b.id]);
    const session = store.createSession(
      workspaceId,
      undefined,
      "builtin",
      project.id,
    );
    expect(session.serverId).toBeUndefined();
    store.updateSession(session.id, { serverId: a.id });
    expect(store.sessionDirectory(session.id)).toBe(project.directory);
    store.updateSession(session.id, { serverId: b.id });
    store.updateSession(session.id, { serverId: null });
    expect(store.session(session.id).serverId).toBeUndefined();
    store.close();
    const restored = await Store.open(path, vault);
    expect(restored.project(project.id)).toMatchObject({
      includeLocal: true,
      directory: project.directory,
      serverIds: [a.id, b.id],
      remoteDirectory: "/srv/service",
    });
    restored.close();
  });
  it("supports multiple server targets without treating remote project paths as local directories", async () => {
    const { store, path } = await open();
    const workspaceId = randomUUID();
    const a = store.saveServer({ ...input, name: "Alpha" });
    const b = store.saveServer({
      ...input,
      name: "Beta",
      host: "beta.example.com",
    });
    const other = store.saveServer({
      ...input,
      name: "Unrelated",
      host: "other.example.com",
    });
    expect(() =>
      store.saveProject({
        workspaceId,
        name: "Empty remote",
        includeLocal: false,
        serverIds: [],
      }),
    ).toThrow("至少需要关联");
    const project = store.saveProject({
      workspaceId,
      name: "Remote deployment",
      includeLocal: false,
      serverIds: [a.id, b.id, a.id],
      remoteDirectory: "/srv/not-a-local-directory",
    });
    expect(project.serverIds).toEqual([a.id, b.id]);
    expect(project.directory).toBeUndefined();
    const session = store.createSession(
      workspaceId,
      undefined,
      "builtin",
      project.id,
    );
    expect(session.serverId).toBeUndefined();
    expect(store.sessionDirectory(session.id)).toBeUndefined();
    store.appendMessage(session.id, {
      id: randomUUID(),
      role: "user",
      text: "keep this history",
    });
    store.updateSession(session.id, { serverId: b.id });
    expect(() =>
      store.updateSession(session.id, { serverId: other.id }),
    ).toThrow("项目关联");
    expect(() => store.checkProjectTarget(session.id, other.id)).toThrow(
      "项目关联",
    );
    store.saveProject({
      id: project.id,
      workspaceId,
      name: project.name,
      serverIds: [a.id],
    });
    const updated = store.updateSession(session.id, { projectId: project.id });
    expect(updated.serverId).toBeUndefined();
    expect(updated.messages[0].text).toBe("keep this history");
    store.close();
    const restored = await Store.open(path, vault);
    expect(restored.project(project.id)).toMatchObject({
      includeLocal: false,
      serverIds: [a.id],
      remoteDirectory: "/srv/not-a-local-directory",
    });
    expect(restored.session(session.id).serverId).toBeUndefined();
    restored.close();
  });
  it("persists project ownership, isolates engine scopes and preserves history when moving or archiving", async () => {
    const { store, path } = await open();
    const workspaceId = randomUUID(),
      anotherWorkspace = randomUUID();
    const directory = join(path, "..");
    const project = store.saveProject({
      workspaceId,
      name: "Development",
      directory,
    });
    const other = store.saveProject({ workspaceId, name: "Operations" });
    const foreign = store.saveProject({
      workspaceId: anotherWorkspace,
      name: "Other workspace",
    });
    const session = store.createSession(
      workspaceId,
      undefined,
      "codex",
      project.id,
    );
    store.appendMessage(session.id, {
      id: randomUUID(),
      role: "user",
      text: "preserved history",
    });
    const agent = new AgentService(store, () => {});
    const initialScope = agent.scope("codex", undefined, undefined, session.id);
    expect(store.sessionDirectory(session.id)).toBe(project.directory);
    store.saveProject({ id: project.id, workspaceId, name: "Renamed" });
    expect(agent.scope("codex", undefined, undefined, session.id)).toBe(
      initialScope,
    );
    expect(() =>
      store.updateSession(session.id, { projectId: foreign.id }),
    ).toThrow("当前工作空间");
    store.updateSession(session.id, { projectId: other.id });
    expect(agent.scope("codex", undefined, undefined, session.id)).not.toBe(
      initialScope,
    );
    expect(store.session(session.id).messages[0].text).toBe(
      "preserved history",
    );
    store.saveProject({
      id: project.id,
      workspaceId,
      name: "Renamed",
      archived: true,
    });
    expect(store.project(project.id).directory).toBe(project.directory);
    expect(() =>
      store.createSession(workspaceId, undefined, "builtin", project.id),
    ).toThrow("未归档");
    store.close();
    const restored = await Store.open(path, vault);
    expect(restored.session(session.id).projectId).toBe(other.id);
    expect(restored.project(project.id).archived).toBe(true);
    expect(restored.session(session.id).messages[0].text).toBe(
      "preserved history",
    );
    restored.close();
  });
  it("persists sessions, isolates records and marks unfinished tasks interrupted on reopen", async () => {
    const { store, path } = await open();
    const workspaceId = randomUUID();
    const first = store.createSession(workspaceId);
    const second = store.createSession(workspaceId);
    store.updateSession(first.id, {
      agentOptions: {
        codex: { model: "codex-model", effort: "high" },
        claude: { model: "sonnet", effort: "medium" },
      },
    });
    const userId = randomUUID(),
      taskId = randomUUID();
    store.appendMessage(first.id, {
      id: userId,
      role: "user",
      text: "调查服务异常",
    });
    store.appendMessage(first.id, {
      id: taskId,
      role: "assistant",
      text: "",
      status: "running",
    });
    store.writeNative(first.id, {
      key: "native-key",
      engine: "claude",
      scope: "local:default",
      nativeId: "existing-id",
      messageCursor: 0,
      recordIds: [],
      pending: true,
    });
    store.recordHandoff(first.id, {
      id: "handoff",
      engine: "claude",
      nativeKey: "native-key",
      resumed: true,
      payload: "existing payload",
      messageIds: [],
      recordIds: [],
      truncated: false,
      createdAt: new Date().toISOString(),
      status: "running",
    });
    store.record({
      id: randomUUID(),
      serverId: randomUUID(),
      command: "uptime",
      code: 0,
      durationMs: 10,
      createdAt: new Date().toISOString(),
      sessionId: first.id,
      proposalKey: "turn:0",
      result: { stdout: "real result", stderr: "", code: 0, truncated: false },
    });
    expect(store.activity(second.id)).toEqual([]);
    expect(store.activity(first.id)[0].result?.stdout).toBe("real result");
    store.close();
    const restored = await Store.open(path, vault);
    expect(restored.session(first.id).title).toBe("调查服务异常");
    expect(restored.session(first.id).agentOptions).toEqual({
      codex: { model: "codex-model", effort: "high" },
      claude: { model: "sonnet", effort: "medium" },
    });
    expect(restored.session(first.id).messages[1].status).toBe("interrupted");
    expect(restored.session(first.id).nativeSessions?.[0]).toMatchObject({
      nativeId: "existing-id",
      pending: false,
      unavailable: true,
    });
    expect(restored.session(first.id).handoffs?.[0].status).toBe("interrupted");
    restored.resetNative(first.id, "claude", "local:default");
    expect(restored.session(first.id).nativeSessions?.[0].retired).toBe(true);
    expect(restored.session(first.id).handoffs).toHaveLength(1);
    expect(restored.session(second.id).messages).toEqual([]);
    expect(restored.activity(first.id)[0].proposalKey).toBe("turn:0");
    restored.close();
  });
  it("preserves legacy records in one historical session without duplicating migration", async () => {
    const { store } = await open();
    const workspaceId = randomUUID();
    store.record({
      id: randomUUID(),
      serverId: randomUUID(),
      command: "pwd",
      code: null,
      durationMs: 5,
      createdAt: new Date().toISOString(),
    });
    store.importLegacyActivity(workspaceId);
    store.importLegacyActivity(workspaceId);
    expect(store.sessions()).toHaveLength(1);
    expect(store.sessions()[0].title).toBe("历史执行记录");
    expect(store.activity(store.sessions()[0].id)[0]).toMatchObject({
      command: "pwd",
      code: null,
    });
    store.close();
  });
  it("does not expose credentials to the renderer or store their plaintext", async () => {
    const { store, path } = await open();
    const server = store.saveServer({
      ...input,
      secret: "unique-secret-value-123",
    });
    expect(server.hasSecret).toBe(true);
    expect(server).not.toHaveProperty("secret");
    expect(store.secret(server.id)).toBe("unique-secret-value-123");
    expect(
      readFileSync(path).includes(Buffer.from("unique-secret-value-123")),
    ).toBe(false);
    store.close();
    const reopened = await Store.open(path, vault);
    expect(reopened.server(server.id).name).toBe("test");
    expect(reopened.secret(server.id)).toBe("unique-secret-value-123");
    reopened.close();
  });
  it("retains secrets for label edits but clears them for a different target", async () => {
    const { store } = await open();
    const server = store.saveServer({ ...input, secret: "pass" });
    store.pinHost(server.id, "SHA256:test");
    store.saveServer({ ...input, id: server.id, name: "renamed" });
    expect(store.secret(server.id)).toBe("pass");
    expect(store.server(server.id).fingerprint).toBe("SHA256:test");
    store.saveServer({
      ...input,
      id: server.id,
      host: "different.example.com",
    });
    expect(store.secret(server.id)).toBeUndefined();
    expect(store.server(server.id).fingerprint).toBeUndefined();
    store.close();
  });
  it("refuses to delete a server still referenced as a jump host", async () => {
    const { store } = await open();
    const relay = store.saveServer({ ...input, name: "relay" });
    const web = store.saveServer({
      ...input,
      name: "web",
      jumpServerId: relay.id,
    });
    expect(store.jumpDependents(relay.id).map((s) => s.id)).toEqual([web.id]);
    expect(() => store.removeServer(relay.id)).toThrow(/web/);
    expect(store.server(relay.id).name).toBe("relay");
    store.saveServer({ ...input, id: web.id, name: "web" });
    expect(store.server(web.id).jumpServerId).toBeUndefined();
    store.removeServer(relay.id);
    expect(() => store.server(relay.id)).toThrow(/服务器不存在/);
    store.close();
  });
  it("rejects jump targets that are missing or form a cycle", async () => {
    const { store } = await open();
    const a = store.saveServer({ ...input, name: "a" });
    const b = store.saveServer({ ...input, name: "b", jumpServerId: a.id });
    expect(() => store.assertJumpTarget(b.id, "absent-id")).toThrow(
      /服务器不存在/,
    );
    expect(() => store.assertJumpTarget(a.id, b.id)).toThrow(/循环/);
    expect(() => store.assertJumpTarget(b.id, a.id)).not.toThrow();
    store.close();
  });
  it("never carries an API key to another provider origin", async () => {
    const { store } = await open();
    store.saveSettings({
      baseUrl: "https://api.one.test/v1",
      model: "model",
      apiKey: "private-key",
    });
    store.saveSettings({ baseUrl: "https://api.two.test/v1", model: "model" });
    expect(store.apiKey()).toBeUndefined();
    expect(store.settings().hasApiKey).toBe(false);
    store.close();
  });
  it("does not save a secret when the system vault refuses encryption", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-vault-"));
    dirs.push(dir);
    const store = await Store.open(join(dir, "test.sqlite"), {
      encrypt() {
        throw new Error("vault unavailable");
      },
      decrypt: (v) => v,
    });
    expect(() => store.saveServer({ ...input, secret: "password" })).toThrow(
      "vault unavailable",
    );
    expect(store.listServers()).toHaveLength(0);
    store.close();
  });
});
