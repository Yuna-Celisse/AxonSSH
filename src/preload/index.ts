import { contextBridge, ipcRenderer } from "electron";
import type { AppEvent, AxonAPI } from "../shared/types";
const api: AxonAPI = {
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    save: (input) => ipcRenderer.invoke("projects:save", input),
    chooseDirectory: () => ipcRenderer.invoke("projects:choose-directory"),
  },
  sessions: {
    contextMenu: (id) => ipcRenderer.invoke("sessions:context-menu", id),
    remove: (id) => ipcRenderer.invoke("sessions:remove", id),
    list: (workspaceId) => ipcRenderer.invoke("sessions:list", workspaceId),
    create: (workspaceId, serverId, engine, projectId) =>
      ipcRenderer.invoke(
        "sessions:create",
        workspaceId,
        serverId,
        engine,
        projectId,
      ),
    ensure: (workspaceId) => ipcRenderer.invoke("sessions:ensure", workspaceId),
    update: (id, patch) => ipcRenderer.invoke("sessions:update", id, patch),
  },
  servers: {
    connected: () => ipcRenderer.invoke("servers:connected"),
    list: () => ipcRenderer.invoke("servers:list"),
    save: (input) => ipcRenderer.invoke("servers:save", input),
    remove: (id) => ipcRenderer.invoke("servers:remove", id),
    connect: (id) => ipcRenderer.invoke("servers:connect", id),
    disconnect: (id) => ipcRenderer.invoke("servers:disconnect", id),
    importOpenSshConfig: () => ipcRenderer.invoke("servers:import-ssh-config"),
    contextMenu: (id, options) =>
      ipcRenderer.invoke("servers:context-menu", id, options),
  },
  terminal: {
    open: (id, sessionId) => ipcRenderer.invoke("terminal:open", id, sessionId),
    write: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id, cols, rows) =>
      ipcRenderer.invoke("terminal:resize", id, cols, rows),
    close: (id) => ipcRenderer.invoke("terminal:close", id),
    launch: (engine, selection, sessionId) =>
      ipcRenderer.invoke("terminal:launch", engine, selection, sessionId),
  },
  remote: {
    propose: (id, command, sessionId, proposalKey) =>
      ipcRenderer.invoke("remote:propose", id, command, sessionId, proposalKey),
    execute: (id) => ipcRenderer.invoke("remote:execute", id),
    files: (id, path) => ipcRenderer.invoke("remote:files", id, path),
  },
  agent: {
    run: (input) => ipcRenderer.invoke("agent:run", input),
    cancel: (id) => ipcRenderer.invoke("agent:cancel", id),
    detect: () => ipcRenderer.invoke("agent:detect"),
    models: (engine, refresh) =>
      ipcRenderer.invoke("agent:models", engine, refresh),
    resetNative: (sessionId, engine, serverId, model) =>
      ipcRenderer.invoke(
        "agent:reset-native",
        sessionId,
        engine,
        serverId,
        model,
      ),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input) => ipcRenderer.invoke("settings:save", input),
  },
  activity: {
    list: (sessionId) => ipcRenderer.invoke("activity:list", sessionId),
  },
  onEvent(callback) {
    const listener = (_: unknown, event: AppEvent) => callback(event);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  },
};
contextBridge.exposeInMainWorld("axon", api);
