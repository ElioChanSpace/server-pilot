import React from "react";
// Using a more descriptive set of icons from the Tabler Icons collection
import {
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarRightCollapse,
  TbTerminal2,
  TbServer,
  TbCpu,
  TbDeviceDesktop,
} from "react-icons/tb";
import { FaExchangeAlt } from "react-icons/fa";
import type { AppStats } from "../types/app";
import styles from "./BottomBar.module.css";

interface BottomBarProps {
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  isTransferTrayOpen: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleTransferTray: () => void;
  terminalCount: number;
  serverCount: number;
  appStats: AppStats;
}

const BottomBarComponent: React.FC<BottomBarProps> = ({
  isLeftSidebarOpen,
  isRightSidebarOpen,
  isTransferTrayOpen,
  toggleLeftSidebar,
  toggleRightSidebar,
  toggleTransferTray,
  terminalCount,
  serverCount,
  appStats,
}) => {
  return (
    <div className={styles.bottomBar}>
      <div className={styles.leftGroup}>
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
      <div className={styles.statsGroup}>
        <div className={styles.statItem} title="打开的终端数">
          <TbTerminal2 size={14} />
          <span>{terminalCount}</span>
        </div>
        <div className={styles.statItem} title="服务器总数">
          <TbServer size={14} />
          <span>{serverCount}</span>
        </div>
        <div
          className={styles.statItem}
          title={`内存占用: ${appStats.memoryMb} MB`}
        >
          <TbDeviceDesktop size={14} />
          <span>{appStats.memoryMb} MB</span>
        </div>
        <div className={styles.statItem} title={`CPU 占用: ${appStats.cpuPercent.toFixed(1)}%`}>
          <TbCpu size={14} />
          <span>{appStats.cpuPercent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
};

export const BottomBar = React.memo(BottomBarComponent);
