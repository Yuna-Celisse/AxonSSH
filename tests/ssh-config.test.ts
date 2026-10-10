import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOpenSshConfig, readSshConfigFile } from "../src/main/ssh-config";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "axon-ssh-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("parseOpenSshConfig", () => {
  it("parses single and multiple host blocks with hostnames, ports, and users", () => {
    const sample = `
# Global comment
Host server1
    HostName 192.168.1.100
    User ubuntu
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host jump-host
    HostName jump.example.com
    User admin
    Port 22

Host db-internal
    HostName 10.0.0.5
    User postgres
    ProxyJump jump-host
`;

    const parsed = parseOpenSshConfig(sample);
    expect(parsed).toHaveLength(3);

    expect(parsed[0]).toEqual({
      alias: "server1",
      host: "192.168.1.100",
      port: 2222,
      username: "ubuntu",
      authType: "key",
      privateKeyPath: "~/.ssh/id_ed25519",
      proxyJump: undefined,
    });

    expect(parsed[1]).toEqual({
      alias: "jump-host",
      host: "jump.example.com",
      port: 22,
      username: "admin",
      authType: "agent",
      privateKeyPath: undefined,
      proxyJump: undefined,
    });

    expect(parsed[2]).toEqual({
      alias: "db-internal",
      host: "10.0.0.5",
      port: 22,
      username: "postgres",
      authType: "agent",
      privateKeyPath: undefined,
      proxyJump: "jump-host",
    });
  });

  it("applies global Host * defaults and ignores wildcard entries", () => {
    const sample = `
Host *
    User devuser
    Port 2200
    IdentityFile ~/.ssh/id_rsa

Host myapp
    HostName app.internal
`;

    const parsed = parseOpenSshConfig(sample);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      alias: "myapp",
      host: "app.internal",
      port: 2200,
      username: "devuser",
      authType: "key",
      privateKeyPath: "~/.ssh/id_rsa",
      proxyJump: undefined,
    });
  });

  it("handles key=value formatting and quoted values", () => {
    const sample = `
Host "web-node"
    HostName="1.2.3.4"
    User = "deploy"
    Port = 8022
`;

    const parsed = parseOpenSshConfig(sample);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      alias: "web-node",
      host: "1.2.3.4",
      port: 8022,
      username: "deploy",
      authType: "agent",
      privateKeyPath: undefined,
      proxyJump: undefined,
      proxyCommand: undefined,
    });
  });

  it("ignores Match blocks instead of leaking them into the previous Host", () => {
    const sample = `
Host web
    HostName 10.0.0.1
    User deploy

Match host 10.0.0.1
    User root
    IdentityFile ~/.ssh/other_key

Host other
    HostName 10.0.0.2
`;

    const parsed = parseOpenSshConfig(sample);
    const web = parsed.find((h) => h.alias === "web");
    expect(web?.username).toBe("deploy");
    expect(web?.privateKeyPath).toBeUndefined();
    expect(web?.authType).toBe("agent");
    // The Match block must not become a server of its own either.
    expect(parsed.map((h) => h.alias)).toEqual(["web", "other"]);
  });

  it("binds keywords to every alias on a multi-pattern Host line", () => {
    const parsed = parseOpenSshConfig(`
Host alpha beta
    HostName 192.0.2.10
    User ci
    ProxyJump relay
`);
    expect(
      parsed.map((h) => [h.alias, h.host, h.username, h.proxyJump]),
    ).toEqual([
      ["alpha", "192.0.2.10", "ci", "relay"],
      ["beta", "192.0.2.10", "ci", "relay"],
    ]);
  });

  it("skips wildcard and negated patterns and uses the supplied default user", () => {
    const parsed = parseOpenSshConfig(
      `
Host web-* !web-dev exact
    User ops
    HostName 198.51.100.7
`,
      { defaultUser: "yuna" },
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      alias: "exact",
      host: "198.51.100.7",
      username: "ops",
    });
  });

  it("falls back to the default user when the config names none", () => {
    const parsed = parseOpenSshConfig("Host solo\n    HostName 203.0.113.9", {
      defaultUser: "localuser",
      defaultPort: 2222,
    });
    expect(parsed[0]).toMatchObject({
      username: "localuser",
      port: 2222,
    });
  });

  it("keeps the first value for repeated aliases, as OpenSSH does", () => {
    const parsed = parseOpenSshConfig(`
Host dup
    HostName first.example
    Port 22

Host dup
    HostName second.example
    Port 2200
    IdentityFile ~/.ssh/id_ed25519
`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      host: "first.example",
      port: 22,
      authType: "key",
      privateKeyPath: "~/.ssh/id_ed25519",
    });
  });

  it("exposes ProxyCommand so callers can refuse the entry", () => {
    const parsed = parseOpenSshConfig(
      `
Host bastioned
    HostName 10.0.0.9
    ProxyCommand ssh -W %h:%p gateway
`,
    );
    expect(parsed[0]?.proxyCommand).toBe("ssh -W %h:%p gateway");
  });
});

describe("readSshConfigFile", () => {
  it("inlines Include globs relative to the including file", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "config.d"));
    writeFileSync(join(dir, "config"), "Include config.d/*.conf\nHost main\n");
    writeFileSync(join(dir, "config.d", "10.conf"), "Host included-one\n");
    writeFileSync(join(dir, "config.d", "20.conf"), "Host included-two\n");
    const parsed = parseOpenSshConfig(readSshConfigFile(join(dir, "config")));
    expect(parsed.map((h) => h.alias)).toEqual([
      "included-one",
      "included-two",
      "main",
    ]);
  });

  it("stops on include cycles and missing files", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.conf"), "Include b.conf\nHost a\n");
    writeFileSync(join(dir, "b.conf"), "Include a.conf\nHost b\n");
    writeFileSync(join(dir, "c.conf"), "Include nope.conf\nHost c\n");
    const parsed = parseOpenSshConfig(readSshConfigFile(join(dir, "a.conf")));
    // Includes are inlined in place, so b.conf's Host comes first.
    expect(parsed.map((h) => h.alias)).toEqual(["b", "a"]);
    expect(
      parseOpenSshConfig(readSshConfigFile(join(dir, "c.conf"))).map(
        (h) => h.alias,
      ),
    ).toEqual(["c"]);
  });
});
