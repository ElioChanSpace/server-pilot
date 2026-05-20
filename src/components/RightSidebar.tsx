import React from "react";
import { Server } from "../context/ServerContext";
import styles from "./RightSidebar.module.css";
import ServerDetails from "./ServerDetails";

interface RightSidebarProps {
  isOpen: boolean;
  activeServer: Server | null;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  activeServer,
}) => {
  return (
    <div className={styles.rightSidebar} data-closed={!isOpen}>
      <div className={styles.content}>
        {activeServer ? (
          <ServerDetails server={activeServer} />
        ) : (
          <div className={styles.placeholder}>
            <p>No server selected.</p>
          </div>
        )}
      </div>
    </div>
  );
};
