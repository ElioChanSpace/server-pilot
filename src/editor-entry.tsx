import { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { RemoteFileEditor } from "./components/RemoteFileEditor";
import { getInitialThemeId, applyTheme, THEME_STORAGE_KEY } from "./utils/theme-helpers";
import { APP_THEMES, DEFAULT_THEME } from "./utils/app-themes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const params = new URLSearchParams(window.location.search);
const serverId = params.get("serverId") ?? "";
const filePath = params.get("filePath") ?? "";

// Apply initial theme
const initialThemeId = getInitialThemeId();
const initialTheme = APP_THEMES[initialThemeId] ?? APP_THEMES[DEFAULT_THEME];
applyTheme(initialTheme);

function EditorApp() {
  const currentThemeRef = useRef(initialThemeId);

  // Listen for theme changes via storage event + polling fallback
  useEffect(() => {
    const applyIfChanged = (newId: string | null) => {
      if (newId && newId !== currentThemeRef.current && APP_THEMES[newId]) {
        currentThemeRef.current = newId;
        applyTheme(APP_THEMES[newId]);
      }
    };

    // storage event fires in other windows when localStorage changes
    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        applyIfChanged(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);

    // Polling fallback in case storage event doesn't fire across Tauri webviews
    const interval = setInterval(() => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      applyIfChanged(stored);
    }, 1000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  const handleClose = async () => {
    try {
      await getCurrentWindow().destroy();
    } catch (e) {
      console.error("关闭窗口失败:", e);
    }
  };

  return (
    <RemoteFileEditor
      serverId={serverId}
      filePath={filePath}
      onClose={handleClose}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<EditorApp />);
