import type {
  AxonAPI,
  Server,
  Session,
  Engine,
  Project,
} from "../shared/types";
// The browser preview is a layout preview, not an SSH client. Never stores credentials.
export const isPreview = !window.axon;
if (isPreview) {
  let servers: Server[] = [];
  let sessions: Session[] = [];
  let projects: Project[] = [];
  const createSession = async (
    workspaceId: string,
    serverId?: string,
    engine: Engine = "builtin",
    projectId?: string,
  ) => {
    const now = new Date().toISOString();
    const session: Session = {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      serverId,
      engine,
      title: "新会话",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    sessions.push(session);
    return session;
  };
  const desktopOnly = async (): Promise<never> => {
    throw new Error("请使用 Electron 桌面应用，此浏览器页面仅用于界面预览");
  };
  window.axon = {
    projects: {
      list: async () => projects,
      save: async (input) => {
        const project = {
          ...input,
          id: input.id ?? crypto.randomUUID(),
          archived: input.archived ?? false,
          includeLocal: input.includeLocal ?? true,
          serverIds: input.serverIds ?? [],
        };
        projects = [...projects.filter((p) => p.id !== project.id), project];
        return project;
      },
      chooseDirectory: desktopOnly,
    },
    sessions: {
      contextMenu: desktopOnly,
      remove: async (id) => {
        sessions = sessions.filter((s) => s.id !== id);
        return true;
      },
      list: async () => sessions,
      create: createSession,
      ensure: async (workspaceId) =>
        sessions.find((s) => s.workspaceId === workspaceId) ??
        createSession(workspaceId),
      update: async (id, patch) => {
        const session = sessions.find((s) => s.id === id);
        if (!session) throw new Error("Session 不存在");
        const next = {
          ...session,
          ...patch,
          projectId:
            patch.projectId === null
              ? undefined
              : (patch.projectId ?? session.projectId),
          serverId:
            patch.serverId === null
              ? undefined
              : (patch.serverId ?? session.serverId),
        };
        sessions = sessions.map((s) => (s.id === id ? next : s));
        return next;
      },
    },
    servers: {
      connected: async () => [],
      list: async () => servers,
      save: async ({ secret: _, ...input }) => {
        const value: Server = {
          ...input,
          id: input.id ?? crypto.randomUUID(),
          hasSecret: false,
        };
        servers = [...servers.filter((s) => s.id !== value.id), value];
        return value;
      },
      remove: async (id) => {
        servers = servers.filter((s) => s.id !== id);
      },
      connect: desktopOnly,
      disconnect: desktopOnly,
      importOpenSshConfig: desktopOnly,
      contextMenu: async () => undefined,
    },
    terminal: {
      open: desktopOnly,
      write: desktopOnly,
      resize: desktopOnly,
      close: desktopOnly,
      launch: desktopOnly,
    },
    remote: { propose: desktopOnly, execute: desktopOnly, files: desktopOnly },
    agent: {
      resetNative: desktopOnly,
      models: async () => ({ models: [], error: "请在桌面应用中读取模型目录" }),
      run: desktopOnly,
      cancel: desktopOnly,
      detect: async () => [
        { engine: "codex", installed: false },
        { engine: "claude", installed: false },
      ],
    },
    settings: {
      get: async () => ({
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        hasApiKey: false,
      }),
      save: desktopOnly,
    },
    activity: { list: async () => [] },
    onEvent: () => () => {},
  } satisfies AxonAPI;
}
