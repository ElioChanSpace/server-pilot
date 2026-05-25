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
        <h1>服务器总览</h1>
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <FaServer className={styles.statIcon} />
            <span className={styles.statValue}>{servers.length}</span>
            <span className={styles.statLabel}>服务器</span>
          </div>
          <div className={styles.statItem}>
            <FaFolder className={styles.statIcon} />
            <span className={styles.statValue}>{categories.length}</span>
            <span className={styles.statLabel}>分类</span>
          </div>
        </div>
      </div>
      <div className={styles.content}>
        <ServerList servers={servers} categories={categories} />
      </div>
    </div>
  );
};
