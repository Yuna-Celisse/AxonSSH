import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { AgentService } from "../src/main/agent";
import { Store } from "../src/main/store";
const cleanup: (() => void)[] = [];
afterEach(() => {
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
