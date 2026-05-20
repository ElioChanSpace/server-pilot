import { Category, Server, useServer } from "../context/ServerContext";
import { CategoryDashboard } from "./CategoryDashboard";
import { Settings } from "./Settings";
import { ConsoleView } from "./ConsoleView";
import { TabBar } from "./TabBar";
import LogViewer from "./LogViewer";

interface MainContentProps {
  activeView: "dashboard" | "settings" | "logs";
  activeCategory: Category | null;

  sessions: Server[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;

  connectionError: string | null;
  onDismissError: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({
  activeView,
  activeCategory,
  sessions,
  currentSessionId,
  onSelectSession,
  onCloseSession,
}) => {
  const { servers, categories } = useServer();

  // 这个组件不再需要处理事件或 refs，大大简化了

  if (activeView === "settings") return <Settings />;
  if (activeView === "logs") return <LogViewer />;

  const hasActiveSessions = sessions.length > 0 && currentSessionId;

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
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          onCloseSession={onCloseSession}
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
        {sessions.map((session) => (
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
            <ConsoleView server={session} />
          </div>
        ))}
      </div>
    </main>
  );
};
