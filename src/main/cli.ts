import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import type {
  AgentInput,
  ModelCatalog,
  PermissionPolicy,
} from "../shared/types";
export function permissionArguments(
  engine: "codex" | "claude",
  policy: PermissionPolicy,
  interactive: boolean,
) {
  if (engine === "codex") {
    if (policy === "bypass")
      return ["--dangerously-bypass-approvals-and-sandbox"];
    return [
      "--sandbox",
      policy === "read-only" ? "read-only" : "workspace-write",
      "-a",
      policy === "read-only" || !interactive ? "never" : "on-request",
    ];
  }
  return policy === "bypass"
    ? [
        "--permission-mode",
        "bypassPermissions",
        "--dangerously-skip-permissions",
      ]
    : [
        "--permission-mode",
        policy === "read-only"
          ? "plan"
          : policy === "accept-edits"
            ? "acceptEdits"
            : "default",
      ];
}

export function findExecutable(name: string): string | undefined {
  const extensions =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const folders = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  // Prefer a native executable across all locations before a Windows shell shim.
  for (const ext of extensions)
    for (const folder of folders.filter(Boolean)) {
      const path = join(folder, name + ext);
      try {
        accessSync(
          path,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return path;
      } catch {
        /* next path */
      }
    }
}

export function cliArguments(
  input: Pick<
    AgentInput,
    "engine" | "model" | "effort" | "permissions" | "serverId"
  >,
  prompt?: string,
  nativeId?: string,
) {
  const selected = [
    ...(input.model ? ["--model", input.model] : []),
    ...(input.effort
      ? input.engine === "codex"
        ? ["-c", `model_reasoning_effort=${JSON.stringify(input.effort)}`]
        : ["--effort", input.effort]
      : []),
  ];
  const policy =
    prompt !== undefined && !!input.serverId
      ? "read-only"
      : (input.permissions ?? "ask");
  const permissions = permissionArguments(
    input.engine as "codex" | "claude",
    policy,
    prompt === undefined,
  );
  if (prompt === undefined) return [...permissions, ...selected];
  return input.engine === "codex"
    ? [
        ...permissions,
        "exec",
        ...(nativeId ? ["resume"] : []),
        "--json",
        "--skip-git-repo-check",
        ...selected,
        ...(nativeId ? [nativeId] : []),
        "-",
      ]
    : [
        "-p",
        ...permissions,
        ...(nativeId ? ["--resume", nativeId] : []),
        "--output-format",
        "stream-json",
        "--verbose",
        ...(!input.serverId && policy !== "read-only" ? [] : ["--tools", ""]),
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        ...selected,
      ];
}

const cache = new Map<
  string,
  { until: number; result: Promise<ModelCatalog> }
>();
export function cliModels(
  engine: "codex" | "claude",
  refresh = false,
): Promise<ModelCatalog> {
  const cached = cache.get(engine);
  if (!refresh && cached && cached.until > Date.now()) return cached.result;
  const result = discover(engine).catch(() => ({
    models: [],
    error: "无法读取 CLI 模型目录，请检查版本、登录状态或连接后刷新。",
  }));
  cache.set(engine, { until: Date.now() + 120000, result });
  return result;
}
async function discover(engine: "codex" | "claude"): Promise<ModelCatalog> {
  const executable = findExecutable(engine);
  if (!executable || /\.(cmd|bat)$/i.test(executable))
    throw new Error("Native CLI not found");
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      engine === "codex"
        ? ["app-server", "--stdio"]
        : [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
          ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: homedir(),
      },
    );
    let buffer = "",
      size = 0,
      settled = false;
    const finish = (catalog?: ModelCatalog) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      catalog
        ? resolve(catalog)
        : reject(new Error("Catalog discovery failed"));
    };
    const timer = setTimeout(() => finish(), 12000);
    const send = (message: unknown) =>
      child.stdin.write(JSON.stringify(message) + "\n");
    child.stdin.on("error", () => finish());
    child.on("error", () => finish());
    child.on("close", () => finish());
    child.stderr.on("data", () => {});
    child.stdout.on("data", (data) => {
      size += data.length;
      if (size > 2 * 1024 * 1024) return finish();
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (engine === "codex") {
          if (message.id === 1) {
            if (message.error) return finish();
            send({ method: "initialized" });
            send({
              id: 2,
              method: "model/list",
              params: { limit: 100, includeHidden: false },
            });
          }
          if (message.id === 2) {
            if (!Array.isArray(message.result?.data)) return finish();
            finish({
              models: message.result.data
                .filter((m: any) => typeof m.model === "string")
                .map((m: any) => ({
                  id: m.model,
                  name: m.displayName ?? m.model,
                  description: m.description,
                  efforts: (m.supportedReasoningEfforts ?? [])
                    .map((e: any) => e.reasoningEffort)
                    .filter((e: unknown) => typeof e === "string"),
                  defaultEffort: m.defaultReasoningEffort,
                })),
            });
          }
        } else if (
          message.type === "control_response" &&
          message.response?.request_id === "axon-models"
        ) {
          const models = message.response.response?.models;
          if (!Array.isArray(models)) return finish();
          finish({
            models: models
              .filter((m: any) => typeof m.value === "string")
              .map((m: any) => ({
                id: m.value,
                name: m.displayName ?? m.value,
                description: m.resolvedModel
                  ? `${m.value} · ${m.resolvedModel}`
                  : m.description,
                efforts: m.supportsEffort
                  ? (m.supportedEffortLevels ?? [])
                  : [],
              })),
          });
        }
      }
    });
    send(
      engine === "codex"
        ? {
            id: 1,
            method: "initialize",
            params: {
              clientInfo: { name: "axonssh", version: "0.1.1" },
              capabilities: { experimentalApi: true },
            },
          }
        : {
            type: "control_request",
            request_id: "axon-models",
            request: { subtype: "initialize" },
          },
    );
  });
}
