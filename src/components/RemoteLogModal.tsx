import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FaRedo, FaTimes } from "react-icons/fa";
import { Server } from "../context/ServerContext";
import styles from "./RemoteLog.module.css";

interface RemoteLogModalProps {
  server: Server;
  onClose: () => void;
}

interface RemoteLogResult {
  path: string;
  lines: string[];
}

export const RemoteLogModal: React.FC<RemoteLogModalProps> = ({ server, onClose }) => {
  const [path, setPath] = useState("");
  const [lineCount, setLineCount] = useState(200);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async (showLoading = false) => {
    const targetPath = path.trim();
    if (!targetPath) {
      setError("请先填写远程日志文件路径。");
      return;
    }

    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await invoke<RemoteLogResult>("read_remote_log", {
        id: server.id,
        path: targetPath,
        lines: lineCount,
      });
      setLogs(result.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [lineCount, path, server.id]);

  useEffect(() => {
    if (!isAutoRefresh) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadLogs(false);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [isAutoRefresh, loadLogs]);

  useEffect(() => {
    if (isAutoRefresh && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isAutoRefresh]);

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h3>远程日志</h3>
            <span>{server.name} · {server.username}@{server.host}:{server.port}</span>
          </div>
          <div className={styles.controls}>
            <input
              type="text"
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="/var/log/syslog"
              onKeyDown={event => {
                if (event.key === "Enter") {
                  void loadLogs(true);
                }
              }}
            />
            <select
              value={lineCount}
              onChange={event => setLineCount(Number(event.target.value))}
              className="select-css"
            >
              <option value={100}>100 行</option>
              <option value={200}>200 行</option>
              <option value={500}>500 行</option>
              <option value={1000}>1000 行</option>
            </select>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => void loadLogs(true)}
              disabled={isLoading}
            >
              <FaRedo size={12} />
              <span>{isLoading ? "读取中..." : "读取"}</span>
            </button>
            <button
              type="button"
              className={styles.actionButton}
              data-active={isAutoRefresh}
              onClick={() => setIsAutoRefresh(prev => !prev)}
            >
              自动刷新：{isAutoRefresh ? "开" : "关"}
            </button>
            <button type="button" className={styles.closeButton} onClick={onClose} title="关闭">
              <FaTimes size={12} />
              <span>关闭</span>
            </button>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div ref={logContainerRef} className={styles.logContainer}>
          {isLoading && logs.length === 0 ? (
            <div className={styles.empty}>正在读取远程日志...</div>
          ) : logs.length === 0 ? (
            <div className={styles.empty}>暂无内容。填写日志路径后点击"读取"。</div>
          ) : (
            logs.map((line, index) => (
              <div key={index} className={styles.logLine}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
