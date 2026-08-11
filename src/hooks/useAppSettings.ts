import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types/settings";
import type { ThemeMode } from "../utils/theme-helpers";

export function useAppSettings(
  theme: ThemeMode,
  setTheme: (theme: ThemeMode) => void,
) {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const confirmOnDisconnectRef = useRef(true);

  useEffect(() => {
    void invoke<AppSettings>("get_app_settings")
      .then(setAppSettings)
      .catch(error => {
        console.error("加载应用设置失败:", error);
      });
  }, []);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    confirmOnDisconnectRef.current = appSettings.confirmOnDisconnect;

    if (appSettings.themePreference === "light" || appSettings.themePreference === "dark") {
      setTheme(appSettings.themePreference);
    } else {
      setTheme(
        window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      );
    }
  }, [appSettings, setTheme]);

  const handleToggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
    setAppSettings(prev => {
      if (!prev) {
        return prev;
      }
      const next: AppSettings = { ...prev, themePreference: theme === "dark" ? "light" : "dark" };
      void invoke("update_app_settings", { payload: next }).catch(error => {
        console.error("保存主题设置失败:", error);
      });
      return next;
    });
  }, [theme, setTheme]);

  const handleTerminalFontSizeChange = useCallback((delta: number) => {
    setAppSettings(prev => {
      if (!prev) {
        return prev;
      }

      const nextFontSize = delta === 0
        ? 14
        : Math.min(24, Math.max(12, prev.terminalFontSize + delta));
      if (nextFontSize === prev.terminalFontSize) {
        return prev;
      }

      const next = { ...prev, terminalFontSize: nextFontSize };
      void invoke("update_app_settings", { payload: next }).catch(error => {
        console.error("保存终端字体设置失败:", error);
      });
      return next;
    });
  }, []);

  return {
    appSettings,
    confirmOnDisconnectRef,
    handleToggleTheme,
    handleTerminalFontSizeChange,
  };
}
