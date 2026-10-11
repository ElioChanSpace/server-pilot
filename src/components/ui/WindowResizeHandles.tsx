import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import styles from "./WindowResizeHandles.module.css";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const HANDLES: Array<{ dir: ResizeDirection; className: string }> = [
  { dir: "North", className: styles.n },
  { dir: "South", className: styles.s },
  { dir: "West", className: styles.w },
  { dir: "East", className: styles.e },
  { dir: "NorthWest", className: styles.nw },
  { dir: "NorthEast", className: styles.ne },
  { dir: "SouthWest", className: styles.sw },
  { dir: "SouthEast", className: styles.se },
];

/**
 * 无边框窗口的边缘缩放手柄：任意边可拖动调整大小
 * （docs/design/principles.md §窗口交互）。需窗口权限
 * core:window:allow-start-resize-dragging。
 */
export const WindowResizeHandles: React.FC = () => {
  const startResize = (direction: ResizeDirection) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void getCurrentWindow()
      .startResizeDragging(direction)
      .catch(err => console.warn("startResizeDragging 失败:", err));
  };

  return (
    <div className={styles.handles} aria-hidden="true">
      {HANDLES.map(handle => (
        <div
          key={handle.dir}
          className={`${styles.handle} ${handle.className}`}
          onMouseDown={startResize(handle.dir)}
        />
      ))}
    </div>
  );
};

export default WindowResizeHandles;
