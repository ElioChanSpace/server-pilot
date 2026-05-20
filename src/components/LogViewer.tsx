import React, { useState, useEffect, useRef } from 'react';
import styles from './LogViewer.module.css';

const LogViewer: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // 模拟日志数据
  useEffect(() => {
    const mockLogs = [
      "[INFO] Application started",
      "[DEBUG] Initializing server connections",
      "[WARN] Low disk space detected",
      "[ERROR] Failed to connect to server 192.168.1.100",
      "[INFO] Server connection established",
      "[DEBUG] Processing user request",
      "[INFO] User authentication successful",
      "[WARN] Memory usage at 85%",
      "[INFO] Backup completed successfully",
      "[ERROR] Database connection timeout"
    ];

    setLogs(mockLogs);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (isAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isAutoScroll]);

  const toggleAutoScroll = () => {
    setIsAutoScroll(!isAutoScroll);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>Application Logs</h3>
        <div className={styles.controls}>
          <button
            className={styles.toggleBtn}
            onClick={toggleAutoScroll}
            data-active={isAutoScroll}
          >
            {isAutoScroll ? 'Auto Scroll ON' : 'Auto Scroll OFF'}
          </button>
          <button className={styles.clearBtn} onClick={clearLogs}>
            Clear Logs
          </button>
        </div>
      </div>

      <div
        ref={logContainerRef}
        className={styles.logContainer}
      >
        {logs.length > 0 ? (
          logs.map((log, index) => (
            <div key={index} className={styles.logLine}>
              <span className={styles.logTimestamp}>
                {new Date().toLocaleTimeString()}
              </span>
              <span className={styles.logMessage}>{log}</span>
            </div>
          ))
        ) : (
          <div className={styles.emptyState}>
            No logs available. Connect to servers to see logs.
          </div>
        )}
      </div>
    </div>
  );
};

export default LogViewer;
