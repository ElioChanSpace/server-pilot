import React from "react";
// Using a more descriptive set of icons from the Tabler Icons collection
import {
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarRightCollapse,
} from "react-icons/tb";
import { FaExchangeAlt } from "react-icons/fa";
import styles from "./BottomBar.module.css";

interface BottomBarProps {
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  isTransferTrayOpen: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleTransferTray: () => void;
}

const BottomBarComponent: React.FC<BottomBarProps> = ({
  isLeftSidebarOpen,
  isRightSidebarOpen,
  isTransferTrayOpen,
  toggleLeftSidebar,
  toggleRightSidebar,
  toggleTransferTray,
}) => {
  return (
    <div className={styles.bottomBar}>
      <button
        className={styles.toggleButton}
        onClick={toggleLeftSidebar}
        data-active={isLeftSidebarOpen}
        title="切换服务器列表"
      >
        <TbLayoutSidebarLeftCollapse size={16} />
      </button>
      <button
        className={styles.toggleButton}
        onClick={toggleRightSidebar}
        data-active={isRightSidebarOpen}
        title="切换详情面板"
      >
        <TbLayoutSidebarRightCollapse size={16} />
      </button>
      <button
        className={styles.toggleButton}
        onClick={toggleTransferTray}
        data-active={isTransferTrayOpen}
        title="切换文件传输面板"
      >
        <FaExchangeAlt size={14} />
      </button>
    </div>
  );
};

export const BottomBar = React.memo(BottomBarComponent);
