import { defineStore } from "pinia";

export type AppearanceMode = "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

const STORAGE_KEY = "kaopu-appearance-mode-v2";
const THEME_COLORS: Record<ResolvedAppearance, string> = {
  light: "#6D5CE7",
  dark: "#8B7CF6",
};

function normalizeMode(value: unknown): AppearanceMode {
  return value === "dark" ? "dark" : "light";
}

function readStoredMode(): AppearanceMode {
  try {
    return normalizeMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "light";
  }
}

function writeStoredMode(mode: AppearanceMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* localStorage can be blocked in private or embedded contexts */
  }
}

function resolveMode(mode: AppearanceMode): ResolvedAppearance {
  return mode;
}

function applyAppearance(mode: AppearanceMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveMode(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.appearanceMode = mode;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const themeMeta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (themeMeta) themeMeta.content = THEME_COLORS[resolved];
}

export const useAppearanceStore = defineStore("appearance", {
  state: () => ({
    mode: "light" as AppearanceMode,
    resolved: "light" as ResolvedAppearance,
  }),
  getters: {
    isDark: (state) => state.resolved === "dark",
    modeLabel: (state) => {
      if (state.mode === "dark") return "深色";
      return "浅色";
    },
  },
  actions: {
    hydrate() {
      this.mode = readStoredMode();
      this.syncResolved();
    },
    setMode(mode: AppearanceMode) {
      this.mode = normalizeMode(mode);
      writeStoredMode(this.mode);
      this.syncResolved();
    },
    cycleMode() {
      const next: AppearanceMode = this.mode === "dark" ? "light" : "dark";
      this.setMode(next);
    },
    syncResolved() {
      this.resolved = resolveMode(this.mode);
      applyAppearance(this.mode);
    },
  },
});

export function applyInitialAppearance() {
  applyAppearance(readStoredMode());
}
