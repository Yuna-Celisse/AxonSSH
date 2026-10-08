import type { AxonAPI, Server } from "../shared/types";
// The browser preview is a layout preview, not an SSH client. Never stores credentials.
export const isPreview = !window.axon;
if (isPreview) {
  let servers: Server[] = [];
  const desktopOnly = async (): Promise<never> => {
    throw new Error("请使用 Electron 桌面应用，此浏览器页面仅用于界面预览");
  };
  window.axon = {
    servers: {
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
