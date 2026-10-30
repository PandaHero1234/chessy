import { useSyncExternalStore } from "react";

export const BOARD_THEMES = {
  green: { label: "Turnier", light: "#ebecd0", dark: "#739552", lastLight: "#f5f682", lastDark: "#b9ca43" },
  wood: { label: "Holz", light: "#f0d9b5", dark: "#b58863", lastLight: "#cdd26a", lastDark: "#aaa23a" },
  ocean: { label: "Ozean", light: "#dee3e6", dark: "#8ca2ad", lastLight: "#c3d887", lastDark: "#92b166" },
  marble: { label: "Marmor", light: "#e8e6e1", dark: "#9e9a92", lastLight: "#e2d58b", lastDark: "#bfae5c" },
  night: { label: "Nacht", light: "#9aa4b8", dark: "#4b5675", lastLight: "#b8c37a", lastDark: "#8b9750" },
  rose: { label: "Rosé", light: "#f4e1e1", dark: "#c48a8f", lastLight: "#efd78b", lastDark: "#cfa55a" },
} as const;
export type BoardTheme = keyof typeof BOARD_THEMES;

export interface Settings {
  boardTheme: BoardTheme;
  appTheme: "system" | "dark" | "light";
  sound: boolean;
  coordinates: boolean;
  legalMoves: boolean;
  animation: boolean;
  autoQueen: boolean;
}

const DEFAULTS: Settings = {
  boardTheme: "green",
  appTheme: "dark",
  sound: true,
  coordinates: true,
  legalMoves: true,
  animation: true,
  autoQueen: false,
};

const KEY = "chessy.settings";
let current: Settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignorieren */
  }
  applyAppTheme();
  for (const l of listeners) l();
}

export function getSettings() {
  return current;
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function applyAppTheme() {
  const t = current.appTheme;
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
