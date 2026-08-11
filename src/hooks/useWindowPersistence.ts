import { useEffect } from "react";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";

export function useWindowPersistence() {
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const sizeKey = "server-pilot-window-size";
    const positionKey = "server-pilot-window-position";

    try {
      const storedSize = window.localStorage.getItem(sizeKey);
      if (storedSize) {
        const { width, height } = JSON.parse(storedSize) as { width: number; height: number };
        void appWindow.setSize(new LogicalSize(width, height));
      }
      const storedPosition = window.localStorage.getItem(positionKey);
      if (storedPosition) {
        const { x, y } = JSON.parse(storedPosition) as { x: number; y: number };
        void appWindow.setPosition(new LogicalPosition(x, y));
      }
    } catch (error) {
      console.error("恢复窗口状态失败:", error);
    }

    let saveTimer: number | null = null;
    const scheduleSave = () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
      saveTimer = window.setTimeout(() => {
        void (async () => {
          try {
            const size = await appWindow.innerSize();
            const position = await appWindow.outerPosition();
            window.localStorage.setItem(sizeKey, JSON.stringify({ width: size.width, height: size.height }));
            window.localStorage.setItem(positionKey, JSON.stringify({ x: position.x, y: position.y }));
          } catch (error) {
            console.error("保存窗口状态失败:", error);
          }
        })();
      }, 400);
    };

    const unlistenFns: Array<() => void> = [];
    void appWindow.onResized(scheduleSave).then(fn => unlistenFns.push(fn));
    void appWindow.onMoved(scheduleSave).then(fn => unlistenFns.push(fn));

    return () => {
      unlistenFns.forEach(fn => fn());
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
    };
  }, []);
}
