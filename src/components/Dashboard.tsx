import React from "react";
import { useServer } from "../context/ServerContext";
import { ServerList } from "./ServerList";
import styles from "./Dashboard.module.css";
import { FaServer, FaFolder } from "react-icons/fa";

export const Dashboard: React.FC = () => {
  const { servers, categories } = useServer();

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1>Server Dashboard</h1>
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <FaServer className={styles.statIcon} />
            <span className={styles.statValue}>{servers.length}</span>
            <span className={styles.statLabel}>Servers</span>
          </div>
          <div className={styles.statItem}>
            <FaFolder className={styles.statIcon} />
            <span className={styles.statValue}>{categories.length}</span>
            <span className={styles.statLabel}>Categories</span>
          </div>
        </div>
      </div>
      <div className={styles.content}>
        <ServerList servers={servers} categories={categories} />
      </div>
    </div>
  );
};
