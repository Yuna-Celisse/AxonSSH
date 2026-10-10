import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface ParsedSshConfigHost {
  alias: string;
  host: string;
  port: number;
  username: string;
  authType: "key" | "agent" | "password";
  privateKeyPath?: string;
  proxyJump?: string;
  /** Present when OpenSSH would use a ProxyCommand we cannot reproduce. */
  proxyCommand?: string;
}

export interface ParseOptions {
  /** OpenSSH falls back to the local login name; callers supply it explicitly. */
  defaultUser?: string;
  defaultPort?: number;
}

type Mode = "global" | "host" | "match";

interface HostBlock {
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
  proxyCommand?: string;
}

const MAX_INCLUDE_DEPTH = 8;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePort(value: string): number | undefined {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : undefined;
}

/**
 * `Match` blocks are dropped rather than merged: their conditions cannot be
 * evaluated here, and inheriting their identity or user settings into the
 * preceding `Host` would mislabel authentication for every connection.
 */
export function parseOpenSshConfig(
  content: string,
  options: ParseOptions = {},
): ParsedSshConfigHost[] {
  const globalDefaults: {
    user?: string;
    port?: number;
    identityFile?: string;
  } = {};
  const blocks = new Map<string, HostBlock>();
  let mode: Mode = "global";
  let current: HostBlock[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const keyword = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)(?:[\s=]+(.*))?$/);
    if (!keyword) continue;

    const key = keyword[1].toLowerCase();
    const value = unquote(keyword[2] ?? "");

    if (key === "host") {
      const patterns = value.split(/\s+/).filter(Boolean);
      if (patterns.length === 1 && patterns[0] === "*") {
        // `Host *` supplies defaults for every following host.
        mode = "global";
        current = [];
      } else {
        mode = "host";
        // A `Host a b` line binds the following keywords to every alias.
        current = [];
        for (const pattern of patterns) {
          if (!pattern || pattern.startsWith("!")) continue;
          // OpenSSH applies the first value it sees for each keyword.
          let block = blocks.get(pattern);
          if (!block) {
            block = {};
            blocks.set(pattern, block);
          }
          current.push(block);
        }
      }
      continue;
    }

    if (key === "match") {
      mode = "match";
      current = [];
      continue;
    }

    if (key === "include") continue; // resolved while loading files

    if (mode === "host") {
      for (const block of current) {
        if (key === "hostname") block.hostName ??= value;
        else if (key === "user") block.user ??= value;
        else if (key === "port") {
          const port = parsePort(value);
          if (port !== undefined) block.port ??= port;
        } else if (key === "identityfile") block.identityFile ??= value;
        else if (key === "proxyjump") block.proxyJump ??= value;
        else if (key === "proxycommand") block.proxyCommand ??= value;
      }
    } else if (mode === "global") {
      if (key === "user") globalDefaults.user ??= value;
      else if (key === "port") {
        const port = parsePort(value);
        if (port !== undefined) globalDefaults.port ??= port;
      } else if (key === "identityfile") {
        globalDefaults.identityFile ??= value;
      }
    }
  }

  const results: ParsedSshConfigHost[] = [];
  for (const [pattern, block] of blocks) {
    // Wildcard aliases are connection templates, not addressable servers.
    if (pattern.includes("*") || pattern.includes("?")) continue;
    const identityFile = block.identityFile ?? globalDefaults.identityFile;
    results.push({
      alias: pattern,
      host: block.hostName ?? pattern,
      port: block.port ?? globalDefaults.port ?? options.defaultPort ?? 22,
      username:
        block.user ?? globalDefaults.user ?? options.defaultUser ?? "root",
      authType: identityFile ? "key" : "agent",
      privateKeyPath: identityFile,
      proxyJump: block.proxyJump,
      proxyCommand: block.proxyCommand,
    });
  }
  return results;
}

/**
 * Expand `~` and a basename glob such as `config.d/*.conf`. Relative patterns
 * resolve against the including file's directory, as OpenSSH does. Globs in the
 * directory part are not supported and yield nothing.
 */
function resolveIncludePattern(pattern: string, baseDir: string): string[] {
  const expanded = pattern.replace(/^~(?=\/|\\|$)/, homedir());
  // Normalise separators: resolve() yields backslashes on Windows.
  const absolute = (isAbsolute(expanded) ? expanded : join(baseDir, expanded))
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  if (!/[*?]/.test(absolute)) return [resolve(absolute)];

  const separator = absolute.lastIndexOf("/");
  const firstGlob = Math.min(
    ...["*", "?"]
      .map((char) => absolute.indexOf(char))
      .filter((index) => index !== -1),
  );
  if (firstGlob <= separator) return [];

  const directory = absolute.slice(0, separator) || "/";
  const matcher = new RegExp(
    `^${absolute
      .slice(separator + 1)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", "[^/]*")
      .replaceAll("?", "[^/]")}$`,
    "i",
  );
  try {
    return readdirSync(directory)
      .filter((entry) => matcher.test(entry))
      .sort()
      .map((entry) => join(directory, entry));
  } catch {
    return [];
  }
}

/**
 * Read a config file and inline its `Include` results in place, mirroring the
 * order OpenSSH uses. Cycles and re-included files are skipped, as is depth
 * beyond `MAX_INCLUDE_DEPTH`.
 */
export function readSshConfigFile(
  path: string,
  seen: Set<string> = new Set(),
  depth = 0,
): string {
  const absolute = resolve(path);
  if (depth > MAX_INCLUDE_DEPTH) return "";
  // `seen` is case-normalised so a self-include on a case-insensitive file
  // system still terminates; reads always use the real path.
  const dedupeKey = (() => {
    try {
      return realpathSync(absolute).toLowerCase();
    } catch {
      return absolute.toLowerCase();
    }
  })();
  if (!existsSync(absolute) || seen.has(dedupeKey)) return "";
  seen.add(dedupeKey);

  let content: string;
  try {
    content = readFileSync(absolute, "utf-8");
  } catch {
    return "";
  }

  const output: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const include = /^include[\s=]+(.+)$/i.exec(rawLine.trim());
    if (!include) {
      output.push(rawLine);
      continue;
    }
    for (const pattern of unquote(include[1]).split(/\s+/).filter(Boolean)) {
      for (const target of resolveIncludePattern(pattern, dirname(absolute))) {
        output.push(readSshConfigFile(target, seen, depth + 1));
      }
    }
  }
  return output.join("\n");
}

export function loadDefaultSshConfig(): string | undefined {
  const configPath = join(homedir(), ".ssh", "config");
  if (!existsSync(configPath)) return undefined;
  const content = readSshConfigFile(configPath).trim();
  return content || undefined;
}
