import { afterEach, describe, expect, it } from "vitest";
import {
  loadWorkspaces,
  workspaceStorageKey,
} from "../src/renderer/workspaces";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete (globalThis as any).localStorage;
});

function stored(state: unknown) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) =>
        key === workspaceStorageKey ? JSON.stringify(state) : null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
}

describe("workspace layout migration", () => {
  it("coerces the retired handoff view instead of resetting stored workspaces", () => {
    stored({
      workspaces: [
        {
          id: "w1",
          name: "我的工作空间",
          serverIds: ["s1"],
          view: "handoff",
          terminalOpen: true,
          agentOpen: true,
          activeSessionId: "session-1",
          engine: "codex",
        },
      ],
      activeId: "w1",
      sidebarCollapsed: true,
    });
    const loaded = loadWorkspaces();
    // A rejected field here would silently fall back to one blank workspace.
    expect(loaded.workspaces).toHaveLength(1);
    expect(loaded.workspaces[0].name).toBe("我的工作空间");
    expect(loaded.workspaces[0].serverIds).toEqual(["s1"]);
    expect(loaded.workspaces[0].activeSessionId).toBe("session-1");
    expect(loaded.workspaces[0].view).toBe("workspace");
    expect(loaded.sidebarCollapsed).toBe(true);
  });

  it("still rejects genuinely unreadable state", () => {
    stored({ workspaces: [], activeId: "missing" });
    const loaded = loadWorkspaces();
    expect(loaded.workspaces).toHaveLength(1);
    expect(loaded.activeId).toBe(loaded.workspaces[0].id);
  });
});
