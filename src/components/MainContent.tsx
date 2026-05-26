import { Category, Server, useServer } from "../context/ServerContext";
import { CategoryDashboard } from "./CategoryDashboard";
import { Settings } from "./Settings";
import { ConsoleView } from "./ConsoleView";
import { TabBar } from "./TabBar";
import type { TerminalSession } from "../types/terminal";

interface MainContentProps {
  activeView: "dashboard" | "settings" | "logs";
  activeCategory: Category | null;

  sessions: TerminalSession[];
  servers: Server[];
  currentSessionId: string | null;
  terminalOutputs: Record<string, { chunks: string[]; resetToken: number }>;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;

  connectionError: string | null;
  onDismissError: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({
  activeView,
  activeCategory,
  sessions,
  servers,
  currentSessionId,
  terminalOutputs,
  onSelectSession,
  onCloseSession,
  onDuplicateSession,
}) => {
  const { categories } = useServer();

  // 这个组件不再需要处理事件或 refs，大大简化了

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
        />
      )}
      <div style={{ flex: 1, position: "relative" }}>
        {/* 仪表盘的显示逻辑 */}
        <div
          style={{
            display: hasActiveSessions ? "none" : "block",
            height: "100%",
          }}
        >
          <CategoryDashboard
            category={activeCategory}
            servers={servers}
            allCategories={categories}
          />
        </div>

        {/* 渲染所有会话的终端，但只显示当前的 */}
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
            />
          </div>
        ))}
      </div>
    </main>
  );
};
