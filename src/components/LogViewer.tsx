import React, { useState, useEffect, useRef } from 'react';
import styles from './LogViewer.module.css';

const LogViewer: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // 模拟日志数据
  useEffect(() => {
    const mockLogs = [
      "[信息] 应用已启动",
      "[调试] 正在初始化服务器连接",
      "[警告] 检测到磁盘空间不足",
      "[错误] 连接服务器 192.168.1.100 失败",
      "[信息] 服务器连接已建立",
      "[调试] 正在处理用户请求",
      "[信息] 用户认证成功",
      "[警告] 内存使用率达到 85%",
      "[信息] 备份已成功完成",
      "[错误] 数据库连接超时"
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
        <h3>应用日志</h3>
        <div className={styles.controls}>
          <button
            className={styles.toggleBtn}
            onClick={toggleAutoScroll}
            data-active={isAutoScroll}
          >
            {isAutoScroll ? '自动滚动：开' : '自动滚动：关'}
          </button>
          <button className={styles.clearBtn} onClick={clearLogs}>
            清空日志
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
            暂无日志。连接服务器后可在这里查看日志。
          </div>
        )}
      </div>
    </div>
  );
};

export default LogViewer;
