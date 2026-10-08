import { z } from "zod";
export const idSchema = z.string().uuid();
export const serverSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(100),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine((v) => !/[\s\x00-\x1f]/.test(v), "主机名不能包含空白或控制字符"),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().min(1).max(100),
    group: z.string().trim().max(100),
    authType: z.enum(["password", "key", "agent"]),
    privateKeyPath: z.string().max(4096).optional(),
    secret: z.string().max(16384).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.authType === "key" && !s.privateKeyPath)
      ctx.addIssue({
        code: "custom",
        path: ["privateKeyPath"],
        message: "请选择私钥路径",
      });
  });
export const commandSchema = z
  .string()
  .trim()
  .min(1)
  .max(16384)
  .refine((v) => !v.includes("\0"), "命令不能包含 NUL");
export const settingsSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .max(2048)
    .refine((v) => {
      const u = new URL(v);
      return (
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
      );
    }, "仅支持 HTTPS 或本机 HTTP，URL 不能包含凭据、查询参数或片段"),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4096).optional(),
  provider: z.enum(["deepseek", "compatible"]).optional(),
  reasoningEffort: z.enum(["none", "low", "high", "max"]).optional(),
});
export const agentSchema = z.object({
  permissions: z
    .enum(["read-only", "ask", "accept-edits", "bypass"])
    .optional(),
  taskId: idSchema,
  engine: z.enum(["builtin", "codex", "claude"]),
  message: z.string().trim().min(1).max(32000),
  serverId: idSchema.optional(),
  sessionId: idSchema.optional(),
  userMessageId: idSchema.optional(),
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !/[\x00-\x1f]/.test(v))
    .optional(),
  effort: z
    .string()
    .regex(/^[a-z_]{1,24}$/)
    .optional(),
});
export const agentSelectionSchema = agentSchema.pick({
  model: true,
  effort: true,
});
export const sessionPatchSchema = z.object({
  permissions: z
    .enum(["read-only", "ask", "accept-edits", "bypass"])
    .optional(),
  projectId: idSchema.nullable().optional(),
  title: z.string().trim().min(1).max(100).optional(),
  serverId: idSchema.nullable().optional(),
  engine: z.enum(["builtin", "codex", "claude"]).optional(),
  agentOptions: z
    .record(z.enum(["builtin", "codex", "claude"]), agentSelectionSchema)
    .optional(),
});
export const projectSchema = z.object({
  includeLocal: z.boolean().optional(),
  serverIds: z.array(idSchema).max(100).optional(),
  remoteDirectory: z
    .string()
    .trim()
    .max(4096)
    .refine(
      (v) => !/[\x00-\x1f]/.test(v) && (!v || v.startsWith("/")),
      "远程目录需为 Linux 绝对路径",
    )
    .optional(),
  id: idSchema.optional(),
  workspaceId: idSchema,
  name: z.string().trim().min(1).max(100),
  directory: z
    .string()
    .trim()
    .max(4096)
    .refine((v) => !v.includes("\0"))
    .optional(),
  archived: z.boolean().optional(),
});
