import { useState, useEffect } from "react";
import { clampRightSidebarWidth, RIGHT_SIDEBAR_WIDTH_KEY } from "../utils/theme-helpers";

export function useRightSidebarResize() {
  const [isResizingRightSidebar, setIsResizingRightSidebar] = useState(false);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY));
    const width = Number.isFinite(storedWidth) ? clampRightSidebarWidth(storedWidth) : 420;
    document.documentElement.style.setProperty("--right-sidebar-width", `${width}px`);
  }, []);

  useEffect(() => {
    if (!isResizingRightSidebar) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = clampRightSidebarWidth(window.innerWidth - event.clientX);
      document.documentElement.style.setProperty("--right-sidebar-width", `${nextWidth}px`);
    };

    const handlePointerUp = () => {
      setIsResizingRightSidebar(false);
      const currentWidth = Number.parseFloat(
        document.documentElement.style.getPropertyValue("--right-sidebar-width"),
      );
      if (Number.isFinite(currentWidth)) {
        window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(currentWidth));
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
  }, [isResizingRightSidebar]);

  return { setIsResizingRightSidebar };
}
