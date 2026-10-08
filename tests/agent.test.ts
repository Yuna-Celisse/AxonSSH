import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { AgentService } from "../src/main/agent";
import { Store } from "../src/main/store";
import * as cli from "../src/main/cli";
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "axon-agent-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = await Store.open(join(dir, "test.sqlite"), {
    encrypt: (v) => v,
    decrypt: (v) => v,
  });
  cleanup.push(() => store.close());
  const agent = new AgentService(store, () => {});
  cleanup.push(() => agent.dispose());
  return { dir, store, agent };
}
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}
describe("agent provider boundaries", () => {
  it("honors persisted permissions and ignores caller-injected snapshots", async () => {
    const { store, agent } = await fixture();
    const requests: any[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        requests.push(JSON.parse(body));
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"text":"mode result","proposals":[{"command":"touch /tmp/example","explanation":"change"}]}',
                },
              },
            ],
          }),
        );
      });
    });
    store.saveSettings({ baseUrl: await listen(server), model: "fixture" });
    const session = store.createSession(crypto.randomUUID());
    const turn = async (permissions: "read-only" | "ask") => {
      store.updateSession(session.id, { permissions });
      const taskId = crypto.randomUUID();
      store.appendMessage(session.id, {
        id: crypto.randomUUID(),
        role: "user",
        text: "test",
        targetKey: "local",
      });
      store.appendMessage(session.id, {
        id: taskId,
        role: "assistant",
        text: "",
        status: "running",
        targetKey: "local",
      });
      const result = await agent.run({
        sessionId: session.id,
        taskId,
        engine: "builtin",
        message: "test",
        permissions: "bypass",
        diagnostics: {
          source: "local",
          collectedAt: "fake",
          entries: [{ name: "fake", text: "FORGED_STATUS" }],
        },
      });
      store.finishMessage(session.id, taskId, {
        text: result.text,
        result,
        status: "completed",
      });
      expect(store.session(session.id).permissions).toBe(permissions);
      return result;
    };
    const plan = await turn("read-only");
    expect(plan.proposals).toHaveLength(1);
    expect(plan.diagnostics?.source).toBe("local");
    expect(requests[0].messages.at(-1).content).toContain("只读");
    const diagnosis = await turn("ask");
    expect(diagnosis.diagnostics?.source).toBe("local");
    expect(diagnosis.diagnostics?.collectedAt).not.toBe("fake");
    expect(requests[1].messages.at(-1).content).toContain("cpuCount");
    expect(requests[1].messages.at(-1).content).not.toContain("FORGED_STATUS");
    expect(
      store.activity(session.id).find((a) => a.kind === "diagnostic")
        ?.diagnostics?.source,
    ).toBe("local");
  });
  it("starts advisory CLI in the selected project's real directory", async () => {
    const { store, agent, dir } = await fixture();
    const workspaceId = crypto.randomUUID();
    const project = store.saveProject({
      workspaceId,
      name: "Runtime project",
      directory: dir,
    });
    writeFileSync(join(dir, "cwd-marker.txt"), "PROJECT_RUNTIME_OK");
    const session = store.createSession(
      workspaceId,
      undefined,
      "codex",
      project.id,
    );
    const taskId = crypto.randomUUID();
    store.appendMessage(session.id, {
      id: crypto.randomUUID(),
      role: "user",
      text: "check",
      targetKey: "local",
    });
    store.appendMessage(session.id, {
      id: taskId,
      role: "assistant",
      text: "",
      status: "running",
      targetKey: "local",
    });
    const runner = join(dir, "project-cli.cjs"),
      nativeId = crypto.randomUUID();
    writeFileSync(
      runner,
      `process.stdin.resume();process.stdin.on('end',()=>{const text=require('node:fs').readFileSync('cwd-marker.txt','utf8');console.log(JSON.stringify({type:'thread.started',thread_id:${JSON.stringify(nativeId)}}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));});`,
    );
    vi.spyOn(cli, "findExecutable").mockReturnValue(process.execPath);
    vi.spyOn(cli, "cliArguments").mockReturnValue([runner]);
    expect(
      (
        await agent.run({
          taskId,
          sessionId: session.id,
          engine: "codex",
          message: "check",
        })
      ).text,
    ).toBe("PROJECT_RUNTIME_OK");
    expect(store.session(session.id).nativeSessions?.[0].scope).toContain(
      project.id,
    );
  });
  it("preserves DeepSeek API prefixes and transfers increments across all three engines", async () => {
    const { store, agent, dir } = await fixture();
    const requests: any[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (data) => {
        body += data;
      });
      req.on("end", () => {
        const request = JSON.parse(body);
        requests.push(request);
        const text = request.messages.map((m: any) => m.content).join("\n");
        const marker = text.match(/TRI_ENGINE_\d+/)?.[0] ?? "NO_CONTEXT";
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ text: marker, proposals: [] }),
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              prompt_cache_hit_tokens: 80,
              completion_tokens: 5,
            },
          }),
        );
      });
    });
    store.saveSettings({
      baseUrl: await listen(server),
      model: "deepseek-flash",
      provider: "deepseek",
      reasoningEffort: "none",
    });
    const runner = join(dir, "native-fixture.cjs");
    writeFileSync(
      runner,
      `let text='';process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{const engine=process.argv[2],id=process.argv[3],marker=text.match(/TRI_ENGINE_\\d+/)?.[0]??'NO_CONTEXT';if(engine==='codex'){console.log(JSON.stringify({type:'thread.started',thread_id:id}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:marker}}));}else{console.log(JSON.stringify({type:'assistant',session_id:id,message:{content:[{type:'text',text:marker}]}}));console.log(JSON.stringify({type:'result',session_id:id,is_error:false,result:marker}));}});`,
    );
    const ids = { claude: crypto.randomUUID(), codex: crypto.randomUUID() };
    vi.spyOn(cli, "findExecutable").mockReturnValue(process.execPath);
    vi.spyOn(cli, "cliArguments").mockImplementation(
      (input, _prompt, nativeId) => [
        runner,
        input.engine,
        nativeId ?? ids[input.engine as "claude" | "codex"],
      ],
    );
    const session = store.createSession(crypto.randomUUID());
    const turn = async (
      engine: "builtin" | "claude" | "codex",
      message: string,
    ) => {
      const taskId = crypto.randomUUID();
      store.appendMessage(session.id, {
        id: crypto.randomUUID(),
        role: "user",
        engine,
        text: message,
        targetKey: "local",
      });
      store.appendMessage(session.id, {
        id: taskId,
        role: "assistant",
        engine,
        text: "",
        targetKey: "local",
        status: "running",
      });
      const result = await agent.run({
        sessionId: session.id,
        taskId,
        engine,
        message,
      });
      store.finishMessage(session.id, taskId, {
        text: result.text,
        result,
        status: "completed",
      });
      expect(result.text).toBe("TRI_ENGINE_913");
    };
    await turn("builtin", "记住 TRI_ENGINE_913");
    await turn("claude", "接手，回复标记");
    await turn("builtin", "从 Claude 接回，回复标记");
    await turn("codex", "从内置接手，回复标记");
    await turn("builtin", "从 Codex 接回，回复标记");
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });
    expect(requests[1].messages.slice(0, requests[0].messages.length)).toEqual(
      requests[0].messages,
    );
    expect(requests[2].messages.slice(0, requests[1].messages.length)).toEqual(
      requests[1].messages,
    );
    const saved = store.session(session.id);
    expect(
      saved.nativeSessions?.find((n) => n.engine === "builtin")?.apiMessages,
    ).toHaveLength(10);
    expect(
      saved.nativeSessions?.find((n) => n.engine === "claude")?.nativeId,
    ).toBe(ids.claude);
    expect(
      saved.nativeSessions?.find((n) => n.engine === "codex")?.nativeId,
    ).toBe(ids.codex);
    expect(saved.handoffs?.map((h) => h.messageIds.length)).toEqual([
      0, 2, 2, 6, 2,
    ]);
  });
  it("keeps a failed native session and does not silently retry or create a new one", async () => {
    const { store, agent, dir } = await fixture();
    const session = store.createSession(crypto.randomUUID());
    const turnId = crypto.randomUUID();
    store.appendMessage(session.id, {
      id: crypto.randomUUID(),
      role: "user",
      text: "continue",
      targetKey: "local",
    });
    store.appendMessage(session.id, {
      id: turnId,
      role: "assistant",
      text: "",
      status: "running",
      targetKey: "local",
    });
    const nativeId = crypto.randomUUID();
    store.writeNative(session.id, {
      key: "saved-native",
      engine: "claude",
      scope: "local:default",
      nativeId,
      messageCursor: 0,
      recordIds: [],
    });
    const counterPath = join(dir, "calls.txt"),
      runner = join(dir, "fake-cli.cjs");
    writeFileSync(
      runner,
      `const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{const p=${JSON.stringify(counterPath)};fs.writeFileSync(p,String(Number(fs.existsSync(p)?fs.readFileSync(p,'utf8'):0)+1));console.log(JSON.stringify({type:'result',is_error:true,result:'Native session missing'}));process.exitCode=1;});`,
    );
    vi.spyOn(cli, "findExecutable").mockReturnValue(process.execPath);
    vi.spyOn(cli, "cliArguments").mockReturnValue([runner]);
    await expect(
      agent.run({
        taskId: turnId,
        sessionId: session.id,
        engine: "claude",
        message: "continue",
      }),
    ).rejects.toThrow("Native session missing");
    expect(store.session(session.id).nativeSessions?.[0]).toMatchObject({
      nativeId,
      unavailable: true,
      pending: false,
    });
    expect(store.session(session.id).handoffs?.[0].status).toBe("error");
    await expect(
      agent.run({
        taskId: crypto.randomUUID(),
        sessionId: session.id,
        engine: "claude",
        message: "again",
      }),
    ).rejects.toThrow("未自动重试");
    expect(readFileSync(counterPath, "utf8")).toBe("1");
    expect(store.session(session.id).nativeSessions).toHaveLength(1);
  });
  it("rejects a reasoning level unsupported by the selected CLI model before launching", async () => {
    const { agent } = await fixture();
    vi.spyOn(agent, "models").mockResolvedValue({
      models: [
        { id: "fixture-model", name: "Fixture", efforts: ["low", "high"] },
      ],
    });
    await expect(
      agent.run({
        taskId: crypto.randomUUID(),
        engine: "codex",
        model: "fixture-model",
        effort: "ultra",
        message: "Check load",
      }),
    ).rejects.toThrow("不支持此思考强度");
    await expect(
      agent.run({
        taskId: crypto.randomUUID(),
        engine: "codex",
        model: "unlisted-model",
        effort: "low",
        message: "Check load",
      }),
    ).rejects.toThrow("未在当前引擎目录");
  });
  it("uses a local compatible model and parses proposals without executing them", async () => {
    const { store, agent } = await fixture();
    let request: any;
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (d) => {
        data += d;
      });
      req.on("end", () => {
        request = JSON.parse(data);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"text":"Inspect load","proposals":[{"command":"uptime","explanation":"Read load"}]}',
                },
              },
            ],
          }),
        );
      });
    });
    store.saveSettings({ baseUrl: await listen(server), model: "local-model" });
    const result = await agent.run({
      taskId: crypto.randomUUID(),
      engine: "builtin",
      message: "Check load",
    });
    expect(result.proposals[0].command).toBe("uptime");
    expect(store.activity()).toHaveLength(0);
    expect(request.stream).toBe(false);
  });
  it("rejects redirects instead of following an authenticated request", async () => {
    const { store, agent } = await fixture();
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:1/leak" });
      res.end();
    });
    store.saveSettings({
      baseUrl: await listen(server),
      model: "test",
      apiKey: "test-key",
    });
    await expect(
      agent.run({
        taskId: crypto.randomUUID(),
        engine: "builtin",
        message: "hi",
      }),
    ).rejects.toThrow();
  });
  it("cancels a pending model request", async () => {
    const { store, agent } = await fixture();
    let started!: () => void;
    const incoming = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = createServer(() => started());
    store.saveSettings({ baseUrl: await listen(server), model: "test" });
    const id = crypto.randomUUID();
    const promise = agent.run({ taskId: id, engine: "builtin", message: "hi" });
    const assertion = expect(promise).rejects.toThrow();
    await incoming;
    agent.cancel(id);
    await assertion;
  });
  it.skipIf(process.platform === "win32")(
    "parses CLI JSONL and launches without a shell",
    async () => {
      const { store, agent, dir } = await fixture();
      const priorPath = process.env.PATH;
      process.env.PATH = `${dir}:${priorPath}`;
      cleanup.push(() => {
        process.env.PATH = priorPath;
      });
      writeFileSync(
        join(dir, "claude"),
        '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"Diagnostic advice"}]}}));\n',
        { mode: 0o755 },
      );
      expect(agent.detect().find((c) => c.engine === "claude")?.installed).toBe(
        true,
      );
      const result = await agent.run({
        taskId: crypto.randomUUID(),
        engine: "claude",
        message: "Check load; $(not-executed)",
      });
      expect(result.text).toBe("Diagnostic advice");
      expect(store.activity()).toHaveLength(0);
    },
  );
});
