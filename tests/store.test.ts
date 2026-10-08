import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/main/store";
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
