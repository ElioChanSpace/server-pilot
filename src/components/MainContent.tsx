import React, { useCallback, useMemo } from "react";
import { Server } from "../context/ServerContext";
import { FaTimes } from "react-icons/fa";
import { ConsoleView } from "./ConsoleView";
import { TabBar } from "./TabBar";
import type { TerminalSession } from "../types/terminal";
import type { TerminalOutputState } from "../types/app";
import styles from "./MainContent.module.css";

// Stable empty array so unrendered sessions don't break memoized children.
const EMPTY_CHUNKS: string[] = [];

interface MainContentProps {
  sessions: TerminalSession[];
  servers: Server[];
  currentSessionId: string | null;
  tabStatuses: Record<string, import('./TabBar').TabRemoteStatus>;
  terminalOutputs: Record<string, TerminalOutputState>;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onCloseSessionsToLeft: (sessionId: string) => void;
  onCloseSessionsToRight: (sessionId: string) => void;
  onCloseServerSessions: (sessionId: string) => void;
  onCloseAllSessions: () => void;
  onTerminalFilesDropped: (sessionId: string, paths: string[]) => void;
  onTerminalCommandExecuted: (sessionId: string, command: string) => void;
  onOpenTool: (tool: import('./TabBar').ToolboxTool, serverId: string, serverName: string) => void;
  onOpenTransferHistory: () => void;
  followCwdEnabled: boolean;
  onToggleFollowCwd: () => void;
  onReorderSessions: (ordered: import('../types/terminal').TerminalSession[]) => void;
  onUpdateSessionMeta: (sessionId: string, patch: Partial<import('../types/terminal').TerminalSession>) => void;
  onSplitSession: (sessionId: string, layout: 'row' | 'column') => void;
  onPaneRatioChange: (sessionId: string, ratio: number) => void;
  terminalFontSize: number;
  terminalScrollback: number;
  onTerminalFontSizeChange: (delta: number) => void;
  onReconnectSession: (sessionId: string) => void;
  disconnectMessage?: string | null;
}

const MainContentComponent: React.FC<MainContentProps> = ({
  sessions,
  servers,
  currentSessionId,
  tabStatuses,
  terminalOutputs,
  onSelectSession,
  onCloseSession,
  onDuplicateSession,
  onCloseSessionsToLeft,
  onCloseSessionsToRight,
  onCloseServerSessions,
  onCloseAllSessions,
  onTerminalFilesDropped,
  onTerminalCommandExecuted,
  onOpenTool,
  onOpenTransferHistory,
  followCwdEnabled,
  onToggleFollowCwd,
  onReorderSessions,
  onUpdateSessionMeta,
  onSplitSession,
  onPaneRatioChange,
  terminalFontSize,
  terminalScrollback,
  onTerminalFontSizeChange,
  onReconnectSession,
  disconnectMessage,
}) => {
  const serverById = useMemo(() => {
    const map = new Map<string, Server>();
    servers.forEach(server => map.set(server.id, server));
    return map;
  }, [servers]);

  const currentSessions = useMemo(
    () =>
      sessions
        .map(session => ({
          session,
          server: serverById.get(session.serverId) ?? null,
        }))
        .filter((entry): entry is { session: TerminalSession; server: Server } => entry.server !== null),
    [sessions, serverById],
  );

  const handleFilesDropped = useCallback(
    (sessionId: string, paths: string[]) => {
      onTerminalFilesDropped(sessionId, paths);
    },
    [onTerminalFilesDropped],
  );

  const filesDroppedBySession = useMemo(() => {
    const map = new Map<string, (paths: string[]) => void>();
    sessions.forEach(session => {
      map.set(session.id, (paths: string[]) => handleFilesDropped(session.id, paths));
    });
    return map;
  }, [handleFilesDropped, sessions]);

  const reconnectBySession = useMemo(() => {
    const map = new Map<string, () => void>();
    sessions.forEach(session => {
      map.set(session.id, () => onReconnectSession(session.id));
    });
    return map;
  }, [onReconnectSession, sessions]);

  const commandCallbackBySession = useMemo(() => {
    const map = new Map<string, (command: string) => void>();
    sessions.forEach(session => {
      map.set(session.id, (command: string) => onTerminalCommandExecuted(session.id, command));
    });
    return map;
  }, [onTerminalCommandExecuted, sessions]);

  // B2: 分屏分组 —— 同 groupId 的会话在一个标签层内分屏展示
  const tabGroups = useMemo(() => {
    const map = new Map<string, { key: string; sessions: TerminalSession[]; layout: 'row' | 'column' }>();
    for (const entry of currentSessions) {
      const session = entry.session;
      const key = session.groupId ?? session.id;
      const group = map.get(key) ?? { key, sessions: [], layout: 'row' as const };
      group.sessions.push(session);
      if (session.paneLayout) {
        group.layout = session.paneLayout;
      }
      map.set(key, group);
    }
    return [...map.values()];
  }, [currentSessions]);

  // 分隔条拖拽：按指针位置调整相邻两个面板的权重
  const handleDividerDrag = useCallback(
    (event: React.MouseEvent, groupSessions: TerminalSession[], dividerIndex: number) => {
      event.preventDefault();
      const container = (event.currentTarget.parentElement as HTMLElement | null);
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const horizontal = container.dataset.layout === 'row';
      const prev = groupSessions[dividerIndex - 1];
      const next = groupSessions[dividerIndex];
      const totalRatio = (prev.paneRatio ?? 1) + (next.paneRatio ?? 1);

      const onMove = (ev: MouseEvent) => {
        const pos = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
        const size = horizontal ? rect.width : rect.height;
        const fraction = Math.min(0.85, Math.max(0.15, pos / size));
        onPaneRatioChange(prev.id, fraction * totalRatio);
        onPaneRatioChange(next.id, (1 - fraction) * totalRatio);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onPaneRatioChange],
  );

  const hasActiveSessions = sessions.length > 0 && currentSessionId;

  return (
    <main className={styles.main}>
      {sessions.length > 0 && (
        <TabBar
          sessions={sessions}
          servers={servers}
          currentSessionId={currentSessionId}
          tabStatuses={tabStatuses}
          onSelectSession={onSelectSession}
          onCloseSession={onCloseSession}
          onDuplicateSession={onDuplicateSession}
          onCloseSessionsToLeft={onCloseSessionsToLeft}
          onCloseSessionsToRight={onCloseSessionsToRight}
          onCloseServerSessions={onCloseServerSessions}
          onCloseAllSessions={onCloseAllSessions}
          onReconnectSession={onReconnectSession}
          onOpenTool={onOpenTool}
          onOpenTransferHistory={onOpenTransferHistory}
          followCwdEnabled={followCwdEnabled}
          onToggleFollowCwd={onToggleFollowCwd}
          onReorderSessions={onReorderSessions}
          onUpdateSessionMeta={onUpdateSessionMeta}
          onSplitSession={onSplitSession}
        />
      )}
      <div className={styles.stage}>
        <div
          className={styles.emptyLayer}
          data-hidden={hasActiveSessions}
        >
          <div className={styles.emptyWrapper}>
            <div className={styles.emptyCard}>
              <h2 className={styles.emptyTitle}>终端工作区</h2>
              <p className={styles.emptyDescription}>
                选择一台服务器后打开终端，这里会显示当前会话内容。
              </p>
            </div>
          </div>
        </div>

        {tabGroups.map(group => {
          const groupActive = group.sessions.some(sess => sess.id === currentSessionId);
          return (
          <div
            key={group.key}
            className={styles.sessionLayer}
            data-hidden={!groupActive}
          >
            <div className={styles.paneGrid} data-layout={group.layout}>
              {group.sessions.map((session, paneIndex) => (
                <React.Fragment key={session.id}>
                  {paneIndex > 0 && (
                    <div
                      className={styles.paneDivider}
                      data-layout={group.layout}
                      onMouseDown={e => handleDividerDrag(e, group.sessions, paneIndex)}
                    />
                  )}
                  <div
                    className={styles.pane}
                    data-active={session.id === currentSessionId}
                    style={{ flex: `${session.paneRatio ?? 1} 1 0` }}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {group.sessions.length > 1 && (
                      <div className={styles.paneTag}>
                        <span>{session.displayId}</span>
                        <button
                          type="button"
                          className={styles.paneClose}
                          title="关闭此面板"
                          onClick={e => {
                            e.stopPropagation();
                            onCloseSession(session.id);
                          }}
                        >
                          <FaTimes size={10} />
                        </button>
                      </div>
                    )}
                    <ConsoleView
              sessionId={session.id}
              outputChunks={terminalOutputs[session.id]?.chunks ?? EMPTY_CHUNKS}
              droppedChunks={terminalOutputs[session.id]?.droppedChunks ?? 0}
              resetToken={terminalOutputs[session.id]?.resetToken ?? 0}
              isActive={session.id === currentSessionId}
              onFilesDropped={filesDroppedBySession.get(session.id)!}
              onCommandExecuted={commandCallbackBySession.get(session.id)}
              fontSize={terminalFontSize}
              scrollback={terminalScrollback}
              status={session.status}
              onReconnect={reconnectBySession.get(session.id)!}
              onFontSizeChange={onTerminalFontSizeChange}
              disconnectMessage={disconnectMessage}
                    />
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </main>
  );
};

export const MainContent = React.memo(MainContentComponent);
