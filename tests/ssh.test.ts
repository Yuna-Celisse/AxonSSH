import { afterEach, describe, expect, it } from "vitest";
import { Server as SSHServer } from "ssh2";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { Store } from "../src/main/store";
import { SSHService } from "../src/main/ssh";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});
async function fixture(confirm: boolean) {
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const server = new SSHServer({ hostKeys: [key.privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) =>
      ctx.method === "password" &&
      ctx.username === "tester" &&
      ctx.password === "password"
        ? ctx.accept()
        : ctx.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (accept, _reject, info) => {
          const stream = accept();
          stream.write(`Executed: ${info.command}\n`);
          stream.stderr.write("diagnostic\n");
          stream.exit(0);
          stream.end();
        });
        session.on("sftp", (accept) => {
          const sftp = accept();
          let listed = false;
          sftp.on("OPENDIR", (id, _path) =>
            sftp.handle(id, Buffer.from("directory")),
          );
          sftp.on("READDIR", (id) => {
            if (listed) {
              sftp.status(id, 1);
              return;
            }
            listed = true;
            sftp.name(id, [
              {
                filename: "readme.txt",
                longname: "readme.txt",
                attrs: {
                  mode: 0o100644,
                  size: 10,
                  uid: 0,
                  gid: 0,
                  atime: 0,
                  mtime: 100,
                },
              },
              {
                filename: "logs",
                longname: "logs",
                attrs: {
                  mode: 0o40755,
                  size: 0,
                  uid: 0,
                  gid: 0,
                  atime: 0,
                  mtime: 100,
                },
              },
            ]);
          });
          sftp.on("CLOSE", (id) => sftp.status(id, 0));
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), "axon-ssh-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = await Store.open(join(dir, "test.sqlite"), {
    encrypt: (v) => Buffer.from(v).toString("base64"),
    decrypt: (v) => Buffer.from(v, "base64").toString(),
  });
  cleanup.push(() => store.close());
  const config = store.saveServer({
    name: "fixture",
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    username: "tester",
    group: "test",
    authType: "password",
    secret: "password",
  });
  let hostPrompts = 0;
  const ssh = new SSHService(
    store,
    () => {},
    async () => {
      hostPrompts++;
      return confirm;
    },
  );
  cleanup.push(() => ssh.dispose());
  return { store, ssh, config, prompts: () => hostPrompts };
}
describe("real SSH transport", () => {
  it("pins an approved host key and captures separate stdout/stderr/exit status", async () => {
    const { ssh, store, config, prompts } = await fixture(true);
    await ssh.connect(config.id);
    expect(prompts()).toBe(1);
    expect(store.server(config.id).fingerprint).toMatch(/^SHA256:/);
    const result = await ssh.execute(config.id, "uname -a");
    expect(result).toEqual({
      stdout: "Executed: uname -a\n",
      stderr: "diagnostic\n",
      code: 0,
      truncated: false,
    });
    expect(store.activity()[0]).toMatchObject({ command: "uname -a", code: 0 });
  });
  it("refuses a first connection when the user rejects the fingerprint", async () => {
    const { ssh, store, config } = await fixture(false);
    await expect(ssh.connect(config.id)).rejects.toThrow();
    expect(store.server(config.id).fingerprint).toBeUndefined();
  });
  it("lists remote SFTP entries and sorts directories before files", async () => {
    const { ssh, config } = await fixture(true);
    await ssh.connect(config.id);
    const entries = await ssh.files(config.id, ".");
    expect(entries.map((e) => e.name)).toEqual(["logs", "readme.txt"]);
    expect(entries[0].directory).toBe(true);
  });
  it("refuses changed host keys without offering to trust them automatically", async () => {
    const { ssh, store, config, prompts } = await fixture(true);
    store.pinHost(config.id, "SHA256:wrong");
    await expect(ssh.connect(config.id)).rejects.toThrow("密钥发生变化");
    expect(prompts()).toBe(0);
  });
});
