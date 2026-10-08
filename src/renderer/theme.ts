import { useSyncExternalStore } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type Theme = "light" | "dark";
const key = "axonssh.theme.v1";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();
function storedMode(): ThemeMode {
  try {
    const mode = localStorage.getItem(key);
    return mode === "light" || mode === "dark" ? mode : "system";
  } catch {
    return "system";
  }
}
let state = { mode: storedMode(), resolved: "dark" as Theme };
function apply() {
  const resolved =
    state.mode === "system" ? (media.matches ? "dark" : "light") : state.mode;
  state = { ...state, resolved };
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  for (const listener of listeners) listener();
}
export function setThemeMode(mode: ThemeMode) {
  // Persist before applying so a storage failure cannot silently lose the choice.
  localStorage.setItem(key, mode);
  state = { ...state, mode };
  apply();
}
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getTheme = () => state;
export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
const systemChanged = () => {
  if (state.mode === "system") apply();
};
media.addEventListener("change", systemChanged);
apply();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    media.removeEventListener("change", systemChanged);
  });

export function terminalTheme() {
  return state.resolved === "light"
    ? {
        background: "#fbfaf8",
        foreground: "#303640",
        cursor: "#965231",
        selectionBackground: "#dfc8b780",
        black: "#343a44",
        red: "#ad3535",
        green: "#397343",
        yellow: "#8b6519",
        blue: "#3263a7",
        magenta: "#86549e",
        cyan: "#207985",
        white: "#646b75",
        brightBlack: "#737985",
        brightRed: "#c04444",
        brightGreen: "#348544",
        brightYellow: "#a07417",
        brightBlue: "#3577c8",
        brightMagenta: "#9e58b6",
        brightCyan: "#258c96",
        brightWhite: "#303640",
      }
    : {
        background: "#101114",
        foreground: "#c7cbd3",
        cursor: "#db9872",
        selectionBackground: "#424553",
        black: "#3b3f48",
        red: "#e16b6b",
        green: "#8ebc88",
        yellow: "#e2bd78",
        blue: "#7ba9db",
        magenta: "#bc94d2",
        cyan: "#79c0c6",
        white: "#d2d6df",
        brightBlack: "#858b98",
        brightRed: "#f58b8b",
        brightGreen: "#a5d39e",
        brightYellow: "#f4d59b",
        brightBlue: "#9fc5ef",
        brightMagenta: "#d5b0e8",
        brightCyan: "#9fd9de",
        brightWhite: "#f4f4f6",
      };
}
