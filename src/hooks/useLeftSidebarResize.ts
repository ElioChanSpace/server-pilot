import { useState, useEffect } from "react";
import { clampLeftSidebarWidth, LEFT_SIDEBAR_WIDTH_KEY } from "../utils/theme-helpers";

export function useLeftSidebarResize() {
  const [isResizingLeftSidebar, setIsResizingLeftSidebar] = useState(false);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(LEFT_SIDEBAR_WIDTH_KEY));
    const width = Number.isFinite(storedWidth) ? clampLeftSidebarWidth(storedWidth) : 250;
    document.documentElement.style.setProperty("--left-sidebar-width", `${width}px`);
  }, []);

  useEffect(() => {
    if (!isResizingLeftSidebar) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = clampLeftSidebarWidth(event.clientX);
      document.documentElement.style.setProperty("--left-sidebar-width", `${nextWidth}px`);
    };

    const handlePointerUp = () => {
      setIsResizingLeftSidebar(false);
      const currentWidth = Number.parseFloat(
        document.documentElement.style.getPropertyValue("--left-sidebar-width"),
      );
      if (Number.isFinite(currentWidth)) {
        window.localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(currentWidth));
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingLeftSidebar]);

  return { setIsResizingLeftSidebar };
}
