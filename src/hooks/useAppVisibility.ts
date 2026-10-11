import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 应用可见性：窗口隐藏/最小化到托盘时为 false。
 * 不可见就不读数（docs/design/principles.md §7）。
 * 注：被其它窗口完全遮挡时各平台行为不一，这里以
 * document.visibilitychange（隐藏/最小化触发）为准。
 */
export function useAppVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof document === "undefined") {
      return true;
    }
    return document.visibilityState === "visible";
  });

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onResized(() => {
        if (disposed) return;
        sync();
      })
      .then(fn => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      unlisten?.();
    };
  }, []);

  return visible;
}
