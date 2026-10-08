import { contextBridge, ipcRenderer } from "electron";
import type { AppEvent, AxonAPI } from "../shared/types";
const api: AxonAPI = {
  servers: {
    list: () => ipcRenderer.invoke("servers:list"),
    save: (input) => ipcRenderer.invoke("servers:save", input),
    remove: (id) => ipcRenderer.invoke("servers:remove", id),
    connect: (id) => ipcRenderer.invoke("servers:connect", id),
    disconnect: (id) => ipcRenderer.invoke("servers:disconnect", id),
  },
  terminal: {
    open: (id) => ipcRenderer.invoke("terminal:open", id),
    write: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id, cols, rows) =>
      ipcRenderer.invoke("terminal:resize", id, cols, rows),
    close: (id) => ipcRenderer.invoke("terminal:close", id),
    launch: (engine) => ipcRenderer.invoke("terminal:launch", engine),
  },
  remote: {
    propose: (id, command) => ipcRenderer.invoke("remote:propose", id, command),
    execute: (id) => ipcRenderer.invoke("remote:execute", id),
    files: (id, path) => ipcRenderer.invoke("remote:files", id, path),
  },
  agent: {
    run: (input) => ipcRenderer.invoke("agent:run", input),
    cancel: (id) => ipcRenderer.invoke("agent:cancel", id),
    detect: () => ipcRenderer.invoke("agent:detect"),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input) => ipcRenderer.invoke("settings:save", input),
  },
  activity: { list: () => ipcRenderer.invoke("activity:list") },
  onEvent(callback) {
    const listener = (_: unknown, event: AppEvent) => callback(event);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  },
};
contextBridge.exposeInMainWorld("axon", api);
