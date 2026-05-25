import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import { invoke } from '@tauri-apps/api/tauri';
import styles from './LogViewer.module.css';

interface LogViewerProps {
  onClose: () => void;
}

interface AppLogSnapshot {
  filePath: string;
  lines: string[];
}

interface ParsedLogLine {
  raw: string;
  timestamp: string;
  level: string;
  message: string;
}

const parseLogLine = (line: string): ParsedLogLine => {
  const match = line.match(/^(.+?) - ([A-Z]+) - (.+?) - (.*)$/);
  if (!match) {
    return {
      raw: line,
      timestamp: '',
      level: 'INFO',
      message: line,
    };
  }

  return {
    raw: line,
    timestamp: match[1],
    level: match[2],
    message: `${match[3]} - ${match[4]}`,
  };
};

const LogViewer: React.FC<LogViewerProps> = ({ onClose }) => {
  const [logs, setLogs] = useState<ParsedLogLine[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logFilePath, setLogFilePath] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true);
    }

    try {
      const snapshot = await invoke<AppLogSnapshot>('read_app_logs', { limit: 800 });
      setLogs(snapshot.lines.map(parseLogLine));
      setLogFilePath(snapshot.filePath);
      setError(null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadLogs(true);

    const timer = window.setInterval(() => {
      void loadLogs(false);
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadLogs]);

  useEffect(() => {
    if (isAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isAutoScroll]);

  const toggleAutoScroll = () => {
    setIsAutoScroll(!isAutoScroll);
  };

  const clearLogs = async () => {
    setIsClearing(true);

    try {
      await invoke('clear_app_logs');
      await loadLogs(false);
      setError(null);
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : String(clearError);
      setError(message);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>应用日志</h3>
        <div className={styles.controls}>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            title="关闭日志"
          >
            <FaTimes size={12} />
            <span>关闭</span>
          </button>
          <button
            className={styles.toggleBtn}
            onClick={toggleAutoScroll}
            data-active={isAutoScroll}
          >
            {isAutoScroll ? '自动滚动：开' : '自动滚动：关'}
          </button>
          <button className={styles.clearBtn} onClick={clearLogs} disabled={isClearing}>
            {isClearing ? '清空中...' : '清空日志'}
          </button>
        </div>
      </div>

      {logFilePath && (
        <div className={styles.logMeta}>日志文件：{logFilePath}</div>
      )}

      <div
        ref={logContainerRef}
        className={styles.logContainer}
      >
        {error ? (
          <div className={styles.emptyState}>读取日志失败：{error}</div>
        ) : isLoading ? (
          <div className={styles.emptyState}>正在加载日志...</div>
        ) : logs.length > 0 ? (
          logs.map((log, index) => (
            <div key={index} className={styles.logLine}>
              {log.timestamp && (
                <span className={styles.logTimestamp}>
                  {log.timestamp}
                </span>
              )}
              <span className={styles.logMessage} data-level={log.level}>
                {log.message}
              </span>
            </div>
          ))
        ) : (
          <div className={styles.emptyState}>
            暂无日志。系统运行后会在这里显示真实日志。
          </div>
        )}
      </div>
    </div>
  );
};

export default LogViewer;
