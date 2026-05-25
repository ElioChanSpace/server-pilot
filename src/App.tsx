import { useState, useRef, useEffect } from "react";
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { ServerProvider, Server, Category, useServer } from "./context/ServerContext";
import { AddServerModal } from "./components/AddServerModal";
import { AddCategoryModal } from "./components/AddCategoryModal";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { BottomBar } from "./components/BottomBar";
import { FileTransferTray } from "./components/FileTransferTray";
import { MainContent } from "./components/MainContent";
import { ContextMenu, ContextMenuAction } from "./components/ContextMenu";
import { FaEdit, FaPlus, FaFolderPlus, FaMoon, FaPlug, FaSun, FaUnlink } from 'react-icons/fa';
import "./App.css";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "server-pilot-theme";

const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const MenuBar: React.FC<{
  onNewCategory: () => void;
  onNewServer: () => void;
  onViewLogs: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}> = ({ onNewCategory, onNewServer, onViewLogs, theme, onToggleTheme }) => {
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
      <div className="menuBarSpacer" />
      <button
        className="themeToggle"
        onClick={onToggleTheme}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? <FaSun size={14} /> : <FaMoon size={14} />}
        <span>{theme === "dark" ? "Light" : "Dark"}</span>
      </button>
    </div>
  );
};

interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

interface TerminalOutputState {
  chunks: string[];
  resetToken: number;
}

const AppContent: React.FC = () => {
  const [sessions, setSessions] = useState<Server[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [isUncategorizedSelected, setIsUncategorizedSelected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"dashboard" | "settings" | "logs">("dashboard");
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [initialCategoryId, setInitialCategoryId] = useState<string | undefined>(undefined);
  const [initialParentId, setInitialParentId] = useState<string | undefined>(undefined);
  const [editingServer, setEditingServer] = useState<Server | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, TerminalOutputState>>({});
  const [isTransferTrayOpen, setIsTransferTrayOpen] = useState(false);
  
  const { connectToServer, disconnectServer, servers } = useServer();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const appendTerminalChunk = (serverId: string, chunk: string) => {
    setTerminalOutputs(prev => ({
      ...prev,
      [serverId]: {
        chunks: [...(prev[serverId]?.chunks ?? []), chunk],
        resetToken: prev[serverId]?.resetToken ?? 0,
      },
    }));
  };

  const resetTerminalOutput = (serverId: string, initialChunks: string[] = []) => {
    setTerminalOutputs(prev => ({
      ...prev,
      [serverId]: {
        chunks: initialChunks,
        resetToken: (prev[serverId]?.resetToken ?? 0) + 1,
      },
    }));
  };

  const removeTerminalOutput = (serverId: string) => {
    setTerminalOutputs(prev => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
  };

  const writeTerminalNotice = (serverId: string, level: "INFO" | "ERROR", message: string) => {
    appendTerminalChunk(serverId, `[${level}] ${message}\r\n`);
  };

  useEffect(() => {
    const unlistenPromises: Array<Promise<UnlistenFn>> = [
      listen<[string, string]>("pty-data", (event) => {
        const [serverId, chunk] = event.payload;
        appendTerminalChunk(serverId, chunk);
      }),
      listen<[string, string]>("connection-log", (event) => {
        const [serverId, message] = event.payload;
        appendTerminalChunk(serverId, `[INFO] ${message}\r\n`);
      }),
    ];

    return () => {
      unlistenPromises.forEach(unlistenPromise => {
        unlistenPromise.then(unlisten => unlisten());
      });
    };
  }, []);

  useEffect(() => {
    setActiveServer(prev => {
      if (!prev) {
        return prev;
      }

      return servers.find(server => server.id === prev.id) ?? prev;
    });
    setSessions(prev =>
      prev.map(session => servers.find(server => server.id === session.id) ?? session)
    );
  }, [servers]);

  const transferTargetServer = activeServer ?? (currentSessionId
    ? servers.find(server => server.id === currentSessionId) ?? null
    : null);

  const clearSelection = () => {
    setActiveServer(null);
    setActiveCategory(null);
    setIsUncategorizedSelected(false);
    setConnectionError(null);
  };

  const handleSelectServer = (server: Server) => {
    clearSelection();
    setActiveServer(server);
  };

  const handleConnectServer = async (server: Server) => {
    clearSelection();
    setActiveServer(server);
    
    const existingSession = sessions.find(s => s.id === server.id);
    if (existingSession && (server.status === 'connected' || server.status === 'connecting')) {
      setCurrentSessionId(server.id);
      setActiveView("dashboard");
    } else {
      if (!existingSession) {
        setSessions(prev => [...prev, server]);
      }
      setCurrentSessionId(server.id);
      setActiveView("dashboard");
      resetTerminalOutput(server.id, [`[INFO] Connecting to ${server.username}@${server.host}:${server.port} ...\r\n`]);
      
      try {
        await connectToServer(server.id);
      } catch (err) {
        const message = err as string;
        writeTerminalNotice(server.id, "ERROR", message);
        setConnectionError(message);
      }
    }
  };

  const handleCloseSession = (sessionId: string) => {
    // --- 新增：调用后端断开连接 ---
    disconnectServer(sessionId).catch(err => console.error("Failed to disconnect:", err));

    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== sessionId);
      if (sessionId === currentSessionId) {
        setCurrentSessionId(newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null);
      }
      return newSessions;
    });
    removeTerminalOutput(sessionId);
  };

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setActiveView("dashboard");
  };

  const handleSelectCategory = (category: Category | null) => {
    clearSelection();
    setActiveCategory(category);
    setIsUncategorizedSelected(category === null);
    setActiveView("dashboard");
    setCurrentSessionId(null); 
  };

  const handleDisconnectServer = async (server: Server) => {
    if (sessions.some(session => session.id === server.id)) {
      handleCloseSession(server.id);
      return;
    }

    try {
      await disconnectServer(server.id);
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
  };

  const handleEditServerSaved = (updatedServer: Server) => {
    setActiveServer(prev => (prev?.id === updatedServer.id ? updatedServer : prev));
    setSessions(prev => prev.map(session => (session.id === updatedServer.id ? { ...session, ...updatedServer } : session)));
    setEditingServer(undefined);
  };

  const handleCategoryContextMenu = (event: React.MouseEvent, category: Category | null) => {
    const actions: ContextMenuAction[] = [
      { label: "New Server", icon: <FaPlus />, action: () => { setEditingServer(undefined); setInitialCategoryId(category?.id); setIsServerModalOpen(true); }},
      { label: "New Sub-Category", icon: <FaFolderPlus />, action: () => { setInitialParentId(category?.id); setIsCategoryModalOpen(true); }}
    ];
    setContextMenu({ x: event.clientX, y: event.clientY, actions });
  };

  // --- 新增：处理服务器右键菜单 ---
  const handleServerContextMenu = (event: React.MouseEvent, server: Server) => {
    const actions: ContextMenuAction[] = [
      {
        label: server.status === 'connected' ? "Open Terminal" : "Connect",
        icon: <FaPlug />,
        action: () => {
          handleConnectServer(server);
        }
      },
      {
        label: "Edit",
        icon: <FaEdit />,
        action: () => {
          setEditingServer(server);
          setInitialCategoryId(server.categoryId);
          setIsServerModalOpen(true);
        }
      }
    ];
    
    if (server.status === 'connected' || server.status === 'connecting') {
      actions.push({
        label: "Disconnect",
        icon: <FaUnlink />,
        action: () => {
          // 断开连接并关闭会话（如果存在）
          handleCloseSession(server.id);
        }
      });
    }

    // 可以添加 "Edit", "Delete" 等其他选项

    if (actions.length > 0) {
      setContextMenu({ x: event.clientX, y: event.clientY, actions });
    }
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener('click', closeContextMenu);
      return () => window.removeEventListener('click', closeContextMenu);
    }
  }, [contextMenu]);


  return (
    <div className="app-wrapper">
      <MenuBar 
        onNewCategory={() => { setInitialParentId(undefined); setIsCategoryModalOpen(true); }}
        onNewServer={() => { setEditingServer(undefined); setInitialCategoryId(undefined); setIsServerModalOpen(true); }}
        onViewLogs={() => setActiveView("logs")}
        theme={theme}
        onToggleTheme={() => setTheme(prev => (prev === "dark" ? "light" : "dark"))}
      />
      <div className="content-wrapper">
        <LeftSidebar 
          isOpen={isLeftSidebarOpen} 
          activeServer={activeServer}
          activeCategory={activeCategory}
          isUncategorizedActive={isUncategorizedSelected}
          onSelectServer={handleSelectServer}
          onSelectCategory={handleSelectCategory}
          onCategoryContextMenu={handleCategoryContextMenu}
          onCreateServer={(category) => { setEditingServer(undefined); setInitialCategoryId(category?.id); setIsServerModalOpen(true); }}
          onCreateSubCategory={(category) => { setInitialParentId(category?.id); setIsCategoryModalOpen(true); }}
          onConnectServer={handleConnectServer}
          onDisconnectServer={handleDisconnectServer}
          onServerContextMenu={handleServerContextMenu} // <-- 传递新的处理函数
        />
        <MainContent 
          activeView={activeView} 
          activeCategory={activeCategory} 
          sessions={sessions}
          currentSessionId={currentSessionId}
          terminalOutputs={terminalOutputs}
          onSelectSession={handleSelectSession}
          onCloseSession={handleCloseSession}
          connectionError={connectionError}
          onDismissError={() => setConnectionError(null)}
        />
        <RightSidebar
          isOpen={isRightSidebarOpen}
          activeServer={activeServer}
          activeCategory={activeCategory}
          isUncategorizedSelected={isUncategorizedSelected}
          connectionError={connectionError}
          onConnectServer={handleConnectServer}
          onDisconnectServer={handleDisconnectServer}
          onDismissError={() => setConnectionError(null)}
        />
      </div>
      <FileTransferTray
        isOpen={isTransferTrayOpen}
        server={transferTargetServer}
      />
      <BottomBar 
        isLeftSidebarOpen={isLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        isTransferTrayOpen={isTransferTrayOpen}
        toggleLeftSidebar={() => setIsLeftSidebarOpen(prev => !prev)}
        toggleRightSidebar={() => setIsRightSidebarOpen(prev => !prev)}
        toggleTransferTray={() => setIsTransferTrayOpen(prev => !prev)}
      />
      {isServerModalOpen && (
        <AddServerModal
          onClose={() => {
            setIsServerModalOpen(false);
            setEditingServer(undefined);
          }}
          initialCategoryId={initialCategoryId}
          existingServer={editingServer}
          onSaved={handleEditServerSaved}
        />
      )}
      {isCategoryModalOpen && <AddCategoryModal onClose={() => setIsCategoryModalOpen(false)} parentId={initialParentId} />}
      {contextMenu && <ContextMenu {...contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}

function App() {
  return (
    <ServerProvider>
      <AppContent />
    </ServerProvider>
  );
}

export default App;
