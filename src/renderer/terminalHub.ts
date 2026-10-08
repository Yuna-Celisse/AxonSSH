import type { AppEvent } from "../shared/types";
const history = new Map<string, string>();
const listeners = new Map<string, (event: AppEvent) => void>();
let unsubscribe: (() => void) | undefined;
export function startTerminalHub() {
  if (!unsubscribe)
    unsubscribe = window.axon.onEvent((event) => {
      if (event.type === "agent:delta") return;
      if (event.type === "terminal:data")
        history.set(
          event.id,
          ((history.get(event.id) ?? "") + event.data).slice(-262144),
        );
      else
        history.set(
          event.id,
          (history.get(event.id) ?? "") + `\r\n[${event.reason}]\r\n`,
        );
      listeners.get(event.id)?.(event);
      if (history.size > 100) {
        for (const id of history.keys()) {
          if (!listeners.has(id)) {
            history.delete(id);
            break;
          }
        }
      }
    });
}
export function subscribeTerminal(
  id: string,
  callback: (event: AppEvent) => void,
) {
  listeners.set(id, callback);
  const data = history.get(id);
  if (data) callback({ type: "terminal:data", id, data });
  return () => {
    if (listeners.get(id) === callback) listeners.delete(id);
  };
}
export function forgetTerminal(id: string) {
  history.delete(id);
  listeners.delete(id);
}
