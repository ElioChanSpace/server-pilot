import React from "react";
import { FaPlug, FaFileImport, FaServer } from "react-icons/fa";
import styles from "./Modal.module.css";

interface WelcomeModalProps {
  onAddServer: () => void;
  onImportSshConfig: () => void;
  onDismiss: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  onAddServer,
  onImportSshConfig,
  onDismiss,
}) => {
  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
      <div className={styles.content}>
        <div className={styles.welcomeIcon}>
          <FaServer size={28} />
        </div>
        <h2 className={styles.title}>欢迎使用 Server Pilot</h2>
        <p className={styles.helpText}>
          连接和管理你的服务器：多会话终端、文件传输、性能监控与远程日志。先添加一台服务器开始吧。
        </p>
        <div className={styles.welcomeActions}>
          <button type="button" className={styles.primaryButton} onClick={onAddServer}>
            <FaPlug />
            <span>添加第一台服务器</span>
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onImportSshConfig}>
            <FaFileImport />
            <span>从 SSH Config 导入</span>
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onDismiss}>
            稍后再说
          </button>
        </div>
      </div>
    </div>
  );
};
