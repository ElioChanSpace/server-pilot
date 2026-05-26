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
import LogViewer from "./components/LogViewer";
import { ContextMenu, ContextMenuAction } from "./components/ContextMenu";
import { FaEdit, FaPlus, FaFolderPlus, FaMoon, FaPlug, FaSun, FaUnlink } from 'react-icons/fa';
import type { TerminalSession } from "./types/terminal";
import "./App.css";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "server-pilot-theme";
const RIGHT_SIDEBAR_WIDTH_KEY = "server-pilot-right-sidebar-width";
const MIN_RIGHT_SIDEBAR_WIDTH = 320;
const MAX_RIGHT_SIDEBAR_WIDTH = 840;

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

const clampRightSidebarWidth = (width: number) =>
  Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, width));

const getInitialRightSidebarWidth = () => {
  if (typeof window === "undefined") {
    return 420;
  }

  const storedWidth = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY));
  return Number.isFinite(storedWidth) ? clampRightSidebarWidth(storedWidth) : 420;
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
    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
    };
  }, []);

  const handleItemClick = (action: () => void) => {
    action();
    setOpenMenu(null);
  };

  return (
    <div className="menuBar" ref={menuRef}>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')} data-active={openMenu === 'file'}>文件</button>
        {openMenu === 'file' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onNewCategory)}>新建分类...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onNewServer)}>新建服务器...</button>
            <div className="separator" />
            <button className="dropdownItem" onClick={() => window.close()}>退出</button>
          </div>
        )}
      </div>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'system' ? null : 'system')} data-active={openMenu === 'system'}>系统</button>
        {openMenu === 'system' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onViewLogs)}>查看日志</button>
          </div>
        )}
      </div>
      <div className="menuBarSpacer" />
      <button
        className="themeToggle"
        onClick={onToggleTheme}
        title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      >
        {theme === "dark" ? <FaSun size={14} /> : <FaMoon size={14} />}
        <span>{theme === "dark" ? "浅色" : "深色"}</span>
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
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(getInitialRightSidebarWidth);
  const [isResizingRightSidebar, setIsResizingRightSidebar] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
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
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, TerminalOutputState>>({});
  const [isTransferTrayOpen, setIsTransferTrayOpen] = useState(false);
  
  const { connectToServer, disconnectServer, closeTerminalSession, servers } = useServer();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    if (!isResizingRightSidebar) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = clampRightSidebarWidth(window.innerWidth - event.clientX);
      setRightSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setIsResizingRightSidebar(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingRightSidebar]);

  const appendTerminalChunk = (sessionId: string, chunk: string) => {
    setTerminalOutputs(prev => ({
      ...prev,
      [sessionId]: {
        chunks: [...(prev[sessionId]?.chunks ?? []), chunk],
        resetToken: prev[sessionId]?.resetToken ?? 0,
      },
    }));
  };

  const resetTerminalOutput = (sessionId: string, initialChunks: string[] = []) => {
    setTerminalOutputs(prev => ({
      ...prev,
      [sessionId]: {
        chunks: initialChunks,
        resetToken: (prev[sessionId]?.resetToken ?? 0) + 1,
      },
    }));
  };

  const removeTerminalOutput = (sessionId: string) => {
    setTerminalOutputs(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  useEffect(() => {
    const unlistenPromises: Array<Promise<UnlistenFn>> = [
      listen<[string, string]>("pty-data", (event) => {
        const [sessionId, chunk] = event.payload;
        appendTerminalChunk(sessionId, chunk);
      }),
      listen<[string, string]>("connection-log", (event) => {
        const [sessionId, message] = event.payload;
        appendTerminalChunk(sessionId, `[INFO] ${message}\r\n`);
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
  }, [servers]);

  const currentSession = currentSessionId
    ? sessions.find(session => session.id === currentSessionId) ?? null
    : null;

  const transferTargetServer = activeServer ?? (currentSession
    ? servers.find(server => server.id === currentSession.serverId) ?? null
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

    setActiveView("dashboard");

    try {
      const result = await connectToServer(server.id);
      setSessions(prev => [
        ...prev,
        {
          id: result.sessionId,
          serverId: server.id,
          terminalIndex: prev.filter(session => session.serverId === server.id).length + 1,
        },
      ]);
      setCurrentSessionId(result.sessionId);
      resetTerminalOutput(result.sessionId, [`[信息] 正在连接 ${server.username}@${server.host}:${server.port} ...\r\n`]);
    } catch (err) {
      const message = err as string;
      setConnectionError(message);
    }
  };

  const handleCloseSession = (sessionId: string) => {
    closeTerminalSession(sessionId).catch(err => console.error("关闭终端失败:", err));

    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== sessionId);
      if (sessionId === currentSessionId) {
        const nextSession = newSessions.length > 0 ? newSessions[newSessions.length - 1] : null;
        setCurrentSessionId(nextSession?.id ?? null);
        if (nextSession) {
          clearSelection();
          const nextServer = servers.find(server => server.id === nextSession.serverId) ?? null;
          if (nextServer) {
            setActiveServer(nextServer);
          }
        }
      }
      return newSessions;
    });
    removeTerminalOutput(sessionId);
  };

  const handleSelectSession = (sessionId: string) => {
    const selectedSession = sessions.find(session => session.id === sessionId) ?? null;
    const selectedServer = selectedSession
      ? servers.find(server => server.id === selectedSession.serverId) ?? null
      : null;

    clearSelection();
    if (selectedServer) {
      setActiveServer(selectedServer);
    }
    setCurrentSessionId(sessionId);
    setActiveView("dashboard");
  };

  const handleDuplicateSession = (sessionId: string) => {
    const session = sessions.find(item => item.id === sessionId);
    if (!session) {
      return;
    }

    const server = servers.find(item => item.id === session.serverId);
    if (!server) {
      return;
    }

    void handleConnectServer(server);
  };

  const handleSelectCategory = (category: Category | null) => {
    clearSelection();
    setActiveCategory(category);
    setIsUncategorizedSelected(category === null);
    setActiveView("dashboard");
    setCurrentSessionId(null); 
  };

  const handleDisconnectServer = async (server: Server) => {
    const relatedSessions = sessions.filter(session => session.serverId === server.id);
    if (relatedSessions.length > 0) {
      relatedSessions.forEach(session => removeTerminalOutput(session.id));
      setSessions(prev => {
        const remainingSessions = prev.filter(session => session.serverId !== server.id);
        if (currentSessionId && relatedSessions.some(session => session.id === currentSessionId)) {
          const nextSession = remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1] : null;
          setCurrentSessionId(nextSession?.id ?? null);
          if (nextSession) {
            const nextServer = servers.find(item => item.id === nextSession.serverId) ?? null;
            clearSelection();
            if (nextServer) {
              setActiveServer(nextServer);
            }
          } else if (activeServer?.id === server.id) {
            clearSelection();
          }
        } else if (activeServer?.id === server.id) {
          clearSelection();
        }
        return remainingSessions;
      });
      disconnectServer(server.id).catch(err => console.error("断开连接失败:", err));
      return;
    }

    try {
      await disconnectServer(server.id);
    } catch (err) {
      console.error("断开连接失败:", err);
    }
  };

  const handleEditServerSaved = (updatedServer: Server) => {
    setActiveServer(prev => (prev?.id === updatedServer.id ? updatedServer : prev));
    setEditingServer(undefined);
  };

  const handleCategoryContextMenu = (event: React.MouseEvent, category: Category | null) => {
    const actions: ContextMenuAction[] = [
      { label: "新建服务器", icon: <FaPlus />, action: () => { setEditingServer(undefined); setInitialCategoryId(category?.id); setIsServerModalOpen(true); }},
      { label: "新建子分类", icon: <FaFolderPlus />, action: () => { setInitialParentId(category?.id); setIsCategoryModalOpen(true); }}
    ];
    setContextMenu({ x: event.clientX, y: event.clientY, actions });
  };

  // --- 新增：处理服务器右键菜单 ---
  const handleServerContextMenu = (event: React.MouseEvent, server: Server) => {
    const actions: ContextMenuAction[] = [
      {
        label: server.status === 'connected' ? "打开终端" : "连接服务器",
        icon: <FaPlug />,
        action: () => {
          handleConnectServer(server);
        }
      },
      {
        label: "编辑",
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
        label: "断开连接",
        icon: <FaUnlink />,
        action: () => {
          // 断开连接并关闭会话（如果存在）
          handleDisconnectServer(server);
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
    if (!contextMenu) {
      return;
    }

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      closeContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
    };
  }, [contextMenu]);


  return (
    <div className="app-wrapper">
      <MenuBar 
        onNewCategory={() => { setInitialParentId(undefined); setIsCategoryModalOpen(true); }}
        onNewServer={() => { setEditingServer(undefined); setInitialCategoryId(undefined); setIsServerModalOpen(true); }}
        onViewLogs={() => setIsLogViewerOpen(true)}
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
        <div className="workspace-shell">
          <MainContent 
            activeView={activeView} 
            activeCategory={activeCategory} 
            sessions={sessions}
            servers={servers}
            currentSessionId={currentSessionId}
            terminalOutputs={terminalOutputs}
            onSelectSession={handleSelectSession}
            onCloseSession={handleCloseSession}
            onDuplicateSession={handleDuplicateSession}
            connectionError={connectionError}
            onDismissError={() => setConnectionError(null)}
          />
          {!isLogViewerOpen && isRightSidebarOpen && (
            <div className="right-sidebar-overlay">
              <div
                className="right-sidebar-resizer"
                onPointerDown={(event) => {
                  event.preventDefault();
                  setIsResizingRightSidebar(true);
                }}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整服务器详情宽度"
              />
              <RightSidebar
                isOpen={true}
                width={rightSidebarWidth}
                activeServer={activeServer}
                activeCategory={activeCategory}
                isUncategorizedSelected={isUncategorizedSelected}
                connectionError={connectionError}
                onConnectServer={handleConnectServer}
                onDisconnectServer={handleDisconnectServer}
                onDismissError={() => setConnectionError(null)}
              />
            </div>
          )}
          {isLogViewerOpen && (
            <div className="log-viewer-overlay">
              <LogViewer onClose={() => setIsLogViewerOpen(false)} />
            </div>
          )}
        </div>
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
      {contextMenu && <ContextMenu {...contextMenu} menuRef={contextMenuRef} onClose={closeContextMenu} />}
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
