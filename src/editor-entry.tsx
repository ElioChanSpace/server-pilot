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

  // 窗口以 visible:false 创建，首帧就绪后再显示 —— 配合入场动画，杜绝白闪/方角
  useEffect(() => {
    const win = getCurrentWindow();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        win.show()
          .then(() => win.setFocus().catch(() => {}))
          .catch(err => {
            // show 失败（如权限缺失）时窗口会一直不可见，必须显式暴露
            console.error("[Editor] win.show() failed:", err);
          });
      });
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
      const win = getCurrentWindow();
      await win.close();
    } catch (e) {
      console.error("[Editor] 关闭窗口失败:", e);
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
