import initSqlJs, { type Database } from "sql.js";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Activity, Server, ServerInput, Settings } from "../shared/types";

export interface Vault {
  encrypt(value: string): string;
  decrypt(value: string): string;
}
export class Store {
  private constructor(
    private db: Database,
    private path: string,
    private vault: Vault,
  ) {}
  static async open(path: string, vault: Vault) {
    const require = createRequire(
      typeof __filename !== "undefined" ? __filename : import.meta.url,
    );
    const SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
    const db = new SQL.Database(
      existsSync(path) ? readFileSync(path) : undefined,
    );
    db.run(`CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, config TEXT NOT NULL, secret TEXT);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, config TEXT NOT NULL, secret TEXT);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, record TEXT NOT NULL);`);
    return new Store(db, path, vault);
  }
  private rows(sql: string, params: (string | number)[] = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  private flush() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, this.db.export(), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
  listServers(): Server[] {
    return this.rows("SELECT config, secret FROM servers").map((r) => ({
      ...JSON.parse(String(r.config)),
      hasSecret: !!r.secret,
    }));
  }
  server(id: string) {
    const value = this.listServers().find((s) => s.id === id);
    if (!value) throw new Error("服务器不存在");
    return value;
  }
  secret(id: string) {
    const row = this.rows("SELECT secret FROM servers WHERE id = ?", [id])[0];
    return row?.secret ? this.vault.decrypt(String(row.secret)) : undefined;
  }
  saveServer(input: ServerInput): Server {
    const { secret, ...config } = input;
    const id = input.id ?? randomUUID();
    const existing = this.rows(
      "SELECT config, secret FROM servers WHERE id = ?",
      [id],
    )[0];
    const previous = existing ? JSON.parse(String(existing.config)) : undefined;
    const sameCredential =
      previous &&
      previous.host === config.host &&
      previous.port === config.port &&
      previous.username === config.username &&
      previous.authType === config.authType &&
      previous.privateKeyPath === config.privateKeyPath;
    const storedSecret =
      secret !== undefined
        ? secret
          ? this.vault.encrypt(secret)
          : null
        : sameCredential
          ? (existing?.secret ?? null)
          : null;
    const fingerprint =
      previous?.host === config.host && previous?.port === config.port
        ? previous.fingerprint
        : undefined;
    this.db.run("INSERT OR REPLACE INTO servers VALUES (?, ?, ?)", [
      id,
      JSON.stringify({ ...config, id, fingerprint }),
      storedSecret as string | null,
    ]);
    this.flush();
    return this.server(id);
  }
  pinHost(id: string, fingerprint: string) {
    const { hasSecret: _, ...server } = this.server(id);
    this.db.run("UPDATE servers SET config = ? WHERE id = ?", [
      JSON.stringify({ ...server, fingerprint }),
      id,
    ]);
    this.flush();
  }
  removeServer(id: string) {
    this.db.run("DELETE FROM servers WHERE id = ?", [id]);
    this.flush();
  }
  settings(): Settings {
    const row = this.rows(
      "SELECT config, secret FROM settings WHERE id = 1",
    )[0];
    return row
      ? { ...JSON.parse(String(row.config)), hasApiKey: !!row.secret }
      : {
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          hasApiKey: false,
        };
  }
  apiKey() {
    const row = this.rows("SELECT secret FROM settings WHERE id = 1")[0];
    return row?.secret ? this.vault.decrypt(String(row.secret)) : undefined;
  }
  saveSettings(input: { baseUrl: string; model: string; apiKey?: string }) {
    const { apiKey, ...config } = input;
    const row = this.rows(
      "SELECT config, secret FROM settings WHERE id = 1",
    )[0];
    const oldBase = row ? JSON.parse(String(row.config)).baseUrl : undefined;
    const sameOrigin =
      oldBase && new URL(oldBase).origin === new URL(config.baseUrl).origin;
    const secret =
      apiKey === undefined
        ? sameOrigin
          ? (row?.secret ?? null)
          : null
        : apiKey
          ? this.vault.encrypt(apiKey)
          : null;
    this.db.run("INSERT OR REPLACE INTO settings VALUES (1, ?, ?)", [
      JSON.stringify(config),
      secret as string | null,
    ]);
    this.flush();
    return this.settings();
  }
  record(activity: Activity) {
    this.db.run("INSERT INTO activity VALUES (?, ?)", [
      activity.id,
      JSON.stringify(activity),
    ]);
    this.db.run(
      "DELETE FROM activity WHERE rowid NOT IN (SELECT rowid FROM activity ORDER BY rowid DESC LIMIT 1000)",
    );
    this.flush();
  }
  activity(): Activity[] {
    return this.rows(
      "SELECT record FROM activity ORDER BY rowid DESC LIMIT 100",
    ).map((r) => JSON.parse(String(r.record)));
  }
  close() {
    this.db.close();
  }
}
