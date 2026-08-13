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
console.log("[Editor] script start, URL:", window.location.search);
const tTheme0 = performance.now();
const initialThemeId = getInitialThemeId();
const initialTheme = APP_THEMES[initialThemeId] ?? APP_THEMES[DEFAULT_THEME];
applyTheme(initialTheme);
console.log("[Editor] initial theme applied in", (performance.now() - tTheme0).toFixed(1), "ms, theme:", initialThemeId);

function EditorApp() {
  console.log("[Editor] EditorApp render");
  const currentThemeRef = useRef(initialThemeId);

  // Listen for theme changes via storage event + polling fallback
  useEffect(() => {
    const applyIfChanged = (newId: string | null) => {
      if (newId && newId !== currentThemeRef.current && APP_THEMES[newId]) {
        const t0 = performance.now();
        console.log("[Editor] theme changing from", currentThemeRef.current, "to", newId);
        currentThemeRef.current = newId;
        applyTheme(APP_THEMES[newId]);
        console.log("[Editor] applyTheme done in", (performance.now() - t0).toFixed(1), "ms");
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
    const t0 = performance.now();
    console.log("[Editor] handleClose called");
    try {
      const win = getCurrentWindow();
      console.log("[Editor] Window label:", win.label);
      await win.close();
      console.log("[Editor] win.close() done in", (performance.now() - t0).toFixed(1), "ms");
    } catch (e) {
      console.error("[Editor] 关闭窗口失败 after", (performance.now() - t0).toFixed(1), "ms:", e);
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
