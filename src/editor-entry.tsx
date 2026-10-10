import { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorWorkspace } from "./editor/EditorWorkspace";
import { getInitialThemeId, applyTheme, THEME_STORAGE_KEY } from "./utils/theme-helpers";
import { APP_THEMES, DEFAULT_THEME } from "./utils/app-themes";
import "./App.css";

const params = new URLSearchParams(window.location.search);
const initialServerId = params.get("serverId");
const initialFilePath = params.get("filePath");
const initial =
  initialServerId && initialFilePath
    ? { serverId: initialServerId, filePath: initialFilePath }
    : undefined;

// Apply initial theme
const initialThemeId = getInitialThemeId();
const initialTheme = APP_THEMES[initialThemeId] ?? APP_THEMES[DEFAULT_THEME];
applyTheme(initialTheme);

function EditorApp() {
  const currentThemeRef = useRef(initialThemeId);

  // 窗口创建即可视（透明窗体在内容渲染前不可见，天然无白闪）；
  // 此处仅负责把窗口前置到焦点。
  useEffect(() => {
    requestAnimationFrame(() => {
      void getCurrentWindow().setFocus().catch(() => {});
    });
  }, []);

  // Listen for theme changes via storage event + polling fallback
  useEffect(() => {
    const applyIfChanged = (newId: string | null) => {
      if (newId && newId !== currentThemeRef.current && APP_THEMES[newId]) {
        currentThemeRef.current = newId;
        applyTheme(APP_THEMES[newId]);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        applyIfChanged(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);

    const interval = setInterval(() => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      applyIfChanged(stored);
    }, 1000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  return <EditorWorkspace initial={initial} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<EditorApp />);
