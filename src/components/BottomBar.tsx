import React from "react";
// Using a more descriptive set of icons from the Tabler Icons collection
import {
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarRightCollapse,
} from "react-icons/tb";
import styles from "./BottomBar.module.css";

interface BottomBarProps {
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
}

export const BottomBar: React.FC<BottomBarProps> = ({
  isLeftSidebarOpen,
  isRightSidebarOpen,
  toggleLeftSidebar,
  toggleRightSidebar,
}) => {
  return (
    <div className={styles.bottomBar}>
      <button
        className={styles.toggleButton}
        onClick={toggleLeftSidebar}
        data-active={isLeftSidebarOpen}
        title="Toggle Server List"
      >
        <TbLayoutSidebarLeftCollapse size={16} />
      </button>
      <button
        className={styles.toggleButton}
        onClick={toggleRightSidebar}
        data-active={isRightSidebarOpen}
        title="Toggle Details Panel"
      >
        <TbLayoutSidebarRightCollapse size={16} />
      </button>
    </div>
  );
};
