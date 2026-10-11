import { z } from "zod";

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  serverIds: z.array(z.string()).default([]),
  // `loadWorkspaces` resets everything when this schema rejects a stored value,
  // so the retired `handoff` view is coerced rather than rejected.
  view: z.preprocess(
    (value) => (value === "handoff" ? "workspace" : value),
    z.enum(["workspace", "terminal", "activity"]).default("workspace"),
  ),
  terminalOpen: z.boolean().default(false),
  agentOpen: z.boolean().default(false),
  selected: z.string().optional(),
  activeSessionId: z.string().optional(),
  engine: z.enum(["builtin", "codex", "claude"]).default("builtin"),
});
const stateSchema = z.object({
  workspaces: z.array(workspaceSchema).min(1),
  activeId: z.string(),
  sidebarCollapsed: z.boolean().default(false),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const workspaceStorageKey = "axonssh.workspaces.v1";

export function newWorkspace(
  name: string,
  serverIds: string[] = [],
): Workspace {
  return workspaceSchema.parse({ id: crypto.randomUUID(), name, serverIds });
}

export function loadWorkspaces() {
  try {
    const value = stateSchema.parse(
      JSON.parse(localStorage.getItem(workspaceStorageKey) ?? "null"),
    );
    if (
      new Set(value.workspaces.map((w) => w.id)).size !==
      value.workspaces.length
    )
      throw new Error("Duplicate workspace IDs");
    if (!value.workspaces.some((w) => w.id === value.activeId))
      value.activeId = value.workspaces[0].id;
    return value;
  } catch {
    const workspace = newWorkspace("我的工作空间");
    return {
      workspaces: [workspace],
      activeId: workspace.id,
      sidebarCollapsed: false,
    };
  }
}
