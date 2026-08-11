export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "server-pilot-theme";
export const RIGHT_SIDEBAR_WIDTH_KEY = "server-pilot-right-sidebar-width";
export const MIN_RIGHT_SIDEBAR_WIDTH = 320;
export const MAX_RIGHT_SIDEBAR_WIDTH = 840;

export const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const clampRightSidebarWidth = (width: number) =>
  Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, width));
