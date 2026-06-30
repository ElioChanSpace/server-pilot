import { Server } from "../context/ServerContext";
import { Settings } from "./Settings";
import { ConsoleView } from "./ConsoleView";
import { TabBar } from "./TabBar";
import type { TerminalSession } from "../types/terminal";

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
}) => {
  if (activeView === "settings") return <Settings />;

  const hasActiveSessions = sessions.length > 0 && currentSessionId;
  const currentSessions = sessions
    .map(session => ({
      session,
      server: servers.find(server => server.id === session.serverId) ?? null,
    }))
    .filter((entry): entry is { session: TerminalSession; server: Server } => entry.server !== null);

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
        />
      )}
      <div style={{ flex: 1, position: "relative" }}>
        <div
          style={{
            display: hasActiveSessions ? "none" : "block",
            height: "100%",
          }}
        >
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "32px",
            }}
          >
            <div
              style={{
                maxWidth: "420px",
                textAlign: "center",
                padding: "24px 28px",
                borderRadius: "20px",
                background: "var(--glass-bg)",
                border: "1px solid var(--glass-border)",
                boxShadow: "0 16px 36px -28px var(--shadow-color)",
              }}
            >
              <h2 style={{ fontSize: "20px", marginBottom: "10px" }}>终端工作区</h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
                选择一台服务器后打开终端，这里会显示当前会话内容。
              </p>
            </div>
          </div>
        </div>

        {currentSessions.map(({ session }) => (
          <div
            key={session.id}
            style={{
              display: session.id === currentSessionId ? "block" : "none",
              height: "100%",
              width: "100%",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <ConsoleView
              sessionId={session.id}
              outputChunks={terminalOutputs[session.id]?.chunks ?? []}
              resetToken={terminalOutputs[session.id]?.resetToken ?? 0}
              isActive={session.id === currentSessionId}
              onFilesDropped={(paths) => onTerminalFilesDropped(session.id, paths)}
            />
          </div>
        ))}
      </div>
    </main>
  );
};
