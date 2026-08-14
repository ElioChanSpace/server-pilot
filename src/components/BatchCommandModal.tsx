import React, { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Server } from "../context/ServerContext";
import type { TerminalSession } from "../types/terminal";
import styles from "./Modal.module.css";

interface BatchCommandModalProps {
  sessions: TerminalSession[];
  servers: Server[];
  onClose: () => void;
}

export const BatchCommandModal: React.FC<BatchCommandModalProps> = ({
  sessions,
  servers,
  onClose,
}) => {
  const serverById = useMemo(() => {
    const map = new Map<string, Server>();
    servers.forEach(server => map.set(server.id, server));
    return map;
  }, [servers]);

  const connectedSessions = useMemo(
    () => sessions.filter(session => session.status === "connected"),
    [sessions],
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(connectedSessions.map(session => session.id)),
  );
  const [command, setCommand] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const toggleSession = (sessionId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const handleRun = async () => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      setError("请输入要执行的命令。");
      return;
    }

    const targets = connectedSessions.filter(session => selected.has(session.id));
    if (targets.length === 0) {
      setError("请至少选择一个已连接的会话。");
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      await Promise.all(targets.map(session =>
        invoke("pty_write", { sessionId: session.id, data: `${trimmedCommand}\r` }),
      ));
      setResult(`已发送到 ${targets.length} 个终端会话。`);
      window.setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.content}>
        <h2 className={styles.title}>批量执行命令</h2>

        {connectedSessions.length === 0 ? (
          <p className={styles.helpText}>当前没有已连接的服务器会话，请先连接至少一台服务器。</p>
        ) : (
          <>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>选择目标会话（{selected.size}/{connectedSessions.length}）</label>
              <div className={styles.candidateList}>
                {connectedSessions.map(session => {
                  const server = serverById.get(session.serverId);
                  const label = server ? `${server.name} (${server.username}@${server.host}:${server.port})` : session.id;
                  return (
                    <label key={session.id} className={styles.candidateRow}>
                      <input
                        type="checkbox"
                        checked={selected.has(session.id)}
                        onChange={() => toggleSession(session.id)}
                      />
                      <span className={styles.candidateName}>{server?.name ?? "终端"}</span>
                      <span className={styles.candidateMeta}>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>命令</label>
              <textarea
                value={command}
                onChange={event => setCommand(event.target.value)}
                placeholder="例如: uptime"
                rows={4}
                className={styles.commandInput}
                onKeyDown={event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handleRun();
                  }
                }}
              />
            </div>
          </>
        )}

        {error && <div className={styles.formError}>{error}</div>}
        {result && <div className={styles.formSuccess}>{result}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRun()}
            disabled={isRunning || connectedSessions.length === 0 || selected.size === 0}
          >
            {isRunning ? "发送中..." : "发送到选中会话"}
          </button>
        </div>
      </div>
    </div>
  );
};
