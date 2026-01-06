import { useState, useRef, useEffect } from "react";
import { listen } from '@tauri-apps/api/event';
import { ServerProvider, Server, Category, useServer } from "./context/ServerContext";
import { TerminalProvider, useTerminalManager } from "./context/TerminalContext"; // <-- 引入
import { AddServerModal } from "./components/AddServerModal";
import { AddCategoryModal } from "./components/AddCategoryModal";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { BottomBar } from "./components/BottomBar";
import { MainContent } from "./components/MainContent";
import { ContextMenu, ContextMenuAction } from "./components/ContextMenu";
import { FaPlus, FaFolderPlus } from 'react-icons/fa';
import "./App.css";

// MenuBar 保持不变...
const MenuBar: React.FC<{
  onNewCategory: () => void;
  onNewServer: () => void;
  onViewLogs: () => void;
}> = ({ onNewCategory, onNewServer, onViewLogs }) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleItemClick = (action: () => void) => {
    action();
    setOpenMenu(null);
  };

  return (
    <div className="menuBar" ref={menuRef}>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')} data-active={openMenu === 'file'}>File</button>
        {openMenu === 'file' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onNewCategory)}>New Category...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onNewServer)}>New Server...</button>
            <div className="separator" />
            <button className="dropdownItem" onClick={() => window.close()}>Quit</button>
          </div>
        )}
      </div>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'system' ? null : 'system')} data-active={openMenu === 'system'}>System</button>
        {openMenu === 'system' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onViewLogs)}>View Logs</button>
          </div>
        )}
      </div>
    </div>
  );
};

interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

const AppContent: React.FC = () => {
  const [sessions, setSessions] = useState<Server[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // ... 其他状态保持不变 ...
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"dashboard" | "settings" | "logs">("dashboard");
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [initialCategoryId, setInitialCategoryId] = useState<string | undefined>(undefined);
  const [initialParentId, setInitialParentId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  
  const { connectToServer } = useServer();
  const { terminalRefs } = useTerminalManager(); // <-- 从 Context 获取 ref Map

  // --- 全局事件总线，现在位于 App.tsx ---
  useEffect(() => {
    console.log("App.tsx: Setting up global event listeners.");
    const unlistenPty = listen<[string, string]>('pty-data', (event) => {
      const [serverId, data] = event.payload;
      const terminal = terminalRefs.current.get(serverId);
      if (terminal) {
        terminal.write(data);
      }
    });

    const unlistenLog = listen<string>('connection-log', (event) => {
      // 广播到所有打开的终端
      terminalRefs.current.forEach(terminal => {
        terminal.write(`[INFO] ${event.payload.replace(/\n/g, '\r\n')}\r\n`);
      });
    });

    return () => {
      console.log("App.tsx: Cleaning up global event listeners.");
      unlistenPty.then(f => f());
      unlistenLog.then(f => f());
    };
  }, [terminalRefs]); // 依赖于稳定的 ref Map

  // ... 其他 handle 函数保持不变 ...
  const clearSelection = () => {
    setActiveServer(null);
    setActiveCategory(null);
    setConnectionError(null);
  };

  const handleSelectServer = (server: Server) => {
    clearSelection();
    setActiveServer(server);
  };

  const handleConnectServer = async (server: Server) => {
    clearSelection();
    
    const existingSession = sessions.find(s => s.id === server.id);
    if (existingSession) {
      setCurrentSessionId(server.id);
      setActiveView("dashboard");
    } else {
      setSessions(prev => [...prev, server]);
      setCurrentSessionId(server.id);
      setActiveView("dashboard");
      
      try {
        await connectToServer(server.id);
      } catch (err) {
        setConnectionError(err as string);
      }
    }
  };

  const handleCloseSession = (sessionId: string) => {
    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== sessionId);
      if (sessionId === currentSessionId) {
        setCurrentSessionId(newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null);
      }
      return newSessions;
    });
  };

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setActiveView("dashboard");
  };

  const handleSelectCategory = (category: Category | null) => {
    clearSelection();
    setActiveCategory(category);
    setActiveView("dashboard");
    setCurrentSessionId(null); 
  };

  const handleCategoryContextMenu = (event: React.MouseEvent, category: Category | null) => {
    const actions: ContextMenuAction[] = [
      { label: "New Server", icon: <FaPlus />, action: () => { setInitialCategoryId(category?.id); setIsServerModalOpen(true); }},
      { label: "New Sub-Category", icon: <FaFolderPlus />, action: () => { setInitialParentId(category?.id); setIsCategoryModalOpen(true); }}
    ];
    setContextMenu({ x: event.clientX, y: event.clientY, actions });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener('click', closeContextMenu);
      return () => window.removeEventListener('click', closeContextMenu);
    }
  }, [contextMenu]);


  return (
    <div className="app-wrapper" onContextMenu={(e) => e.preventDefault()}>
      <MenuBar 
        onNewCategory={() => { setInitialParentId(undefined); setIsCategoryModalOpen(true); }}
        onNewServer={() => { setInitialCategoryId(undefined); setIsServerModalOpen(true); }}
        onViewLogs={() => setActiveView("logs")}
      />
      <div className="content-wrapper">
        <LeftSidebar 
          isOpen={isLeftSidebarOpen} 
          activeServer={activeServer}
          activeCategory={activeCategory}
          onSelectServer={handleSelectServer}
          onSelectCategory={handleSelectCategory}
          onCategoryContextMenu={handleCategoryContextMenu}
          onDoubleClickServer={handleConnectServer}
        />
        <MainContent 
          activeView={activeView} 
          activeCategory={activeCategory} 
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onCloseSession={handleCloseSession}
          connectionError={connectionError}
          onDismissError={() => setConnectionError(null)}
        />
        <RightSidebar isOpen={isRightSidebarOpen} activeServer={activeServer} />
      </div>
      <BottomBar 
        isLeftSidebarOpen={isLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        toggleLeftSidebar={() => setIsLeftSidebarOpen(prev => !prev)}
        toggleRightSidebar={() => setIsRightSidebarOpen(prev => !prev)}
      />
      {isServerModalOpen && <AddServerModal onClose={() => setIsServerModalOpen(false)} initialCategoryId={initialCategoryId} />}
      {isCategoryModalOpen && <AddCategoryModal onClose={() => setIsCategoryModalOpen(false)} parentId={initialParentId} />}
      {contextMenu && <ContextMenu {...contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}

// --- 最终的 App 结构 ---
function App() {
  return (
    <ServerProvider>
      <TerminalProvider> {/* <-- 将 TerminalProvider 包裹在 AppContent 外层 */}
        <AppContent />
      </TerminalProvider>
    </ServerProvider>
  );
}

export default App;