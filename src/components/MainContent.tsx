import React, { Suspense, useCallback, useMemo } from "react";
import { Server } from "../context/ServerContext";
import { ConsoleView } from "./ConsoleView";
import { TabBar } from "./TabBar";
import type { TerminalSession } from "../types/terminal";
import styles from "./MainContent.module.css";

const Settings = React.lazy(() =>
  import("./Settings").then(module => ({ default: module.Settings })),
);

interface MainContentProps {
  activeView: "dashboard" | "settings" | "logs";
  sessions: TerminalSession[];
  servers: Server[];
  currentSessionId: string | null;
  terminalOutputs: Record<string, { chunks: string[]; resetToken: number }>;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onCloseSessionsToLeft: (sessionId: string) => void;
  onCloseSessionsToRight: (sessionId: string) => void;
  onCloseServerSessions: (sessionId: string) => void;
  onCloseAllSessions: () => void;
  onTerminalFilesDropped: (sessionId: string, paths: string[]) => void;
  terminalFontSize: number;
  terminalScrollback: number;
  onTerminalFontSizeChange: (delta: number) => void;
  onReconnectSession: (sessionId: string) => void;
  disconnectMessage?: string | null;
  terminalTheme?: string;
}

export const MainContent: React.FC<MainContentProps> = ({
  activeView,
  sessions,
  servers,
  currentSessionId,
  terminalOutputs,
  onSelectSession,
  onCloseSession,
  onDuplicateSession,
  onCloseSessionsToLeft,
  onCloseSessionsToRight,
  onCloseServerSessions,
  onCloseAllSessions,
  onTerminalFilesDropped,
  terminalFontSize,
  terminalScrollback,
  onTerminalFontSizeChange,
  onReconnectSession,
  disconnectMessage,
  terminalTheme,
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

  if (activeView === "settings") {
    return (
      <Suspense fallback={<div className={styles.lazyFallback}>正在加载设置...</div>}>
        <Settings />
      </Suspense>
    );
  }

  const hasActiveSessions = sessions.length > 0 && currentSessionId;

  return (
    <main className={styles.main}>
      {sessions.length > 0 && (
        <TabBar
          sessions={sessions}
          servers={servers}
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          onCloseSession={onCloseSession}
          onDuplicateSession={onDuplicateSession}
          onCloseSessionsToLeft={onCloseSessionsToLeft}
          onCloseSessionsToRight={onCloseSessionsToRight}
          onCloseServerSessions={onCloseServerSessions}
          onCloseAllSessions={onCloseAllSessions}
          onReconnectSession={onReconnectSession}
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

        {currentSessions.map(({ session }) => (
          <div
            key={session.id}
            className={styles.sessionLayer}
            data-hidden={session.id !== currentSessionId}
          >
            <ConsoleView
              sessionId={session.id}
              outputChunks={terminalOutputs[session.id]?.chunks ?? []}
              resetToken={terminalOutputs[session.id]?.resetToken ?? 0}
              isActive={session.id === currentSessionId}
              onFilesDropped={filesDroppedBySession.get(session.id)!}
              fontSize={terminalFontSize}
              scrollback={terminalScrollback}
              status={session.status}
              onReconnect={reconnectBySession.get(session.id)!}
              onFontSizeChange={onTerminalFontSizeChange}
              disconnectMessage={disconnectMessage}
              themeName={terminalTheme}
            />
          </div>
        ))}
      </div>
    </main>
  );
};
