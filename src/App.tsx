import React, { useState, useRef, useEffect, useCallback, memo, Suspense, lazy } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ServerProvider, useServer } from "./context/ServerContext";
import type { Server, Category } from "./context/ServerContext";
import { AddServerModal } from "./components/AddServerModal";
import { AddCategoryModal } from "./components/AddCategoryModal";
import { ImportSshConfigModal } from "./components/ImportSshConfigModal";
import { BatchCommandModal } from "./components/BatchCommandModal";
import { RemoteLogModal } from "./components/RemoteLogModal";
import { Settings } from "./components/Settings";
import { WelcomeModal } from "./components/WelcomeModal";
import { CommandPalette } from "./components/CommandPalette";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { BottomBar } from "./components/BottomBar";
import { FileTransferTray } from "./components/FileTransferTray";
import { MainContent } from "./components/MainContent";
import { isInsideTerminal } from "./utils/dom-helpers";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuAction } from "./components/ContextMenu";
import { MenuBar } from "./components/MenuBar";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { UploadProgressToast } from "./components/UploadProgressToast";
import { HostKeyPromptModal } from "./components/HostKeyPromptModal";
import { CommandHistoryModal } from "./components/CommandHistoryModal";
import { FaEdit, FaPlus, FaFolderPlus, FaPlug, FaUnlink, FaTrash } from "react-icons/fa";
import type { TerminalSession, TerminalSessionClosedEvent, TerminalSessionStatusEvent } from "./types/terminal";
import type { AppSettings } from "./types/settings";
import type { ContextMenuState, HostKeyPromptEvent, FileTransferProgressEvent } from "./types/app";
import { reindexSessions, resolveNextSessionId } from "./utils/session-helpers";
import { getInitialThemeId, getThemeMode, applyTheme } from "./utils/theme-helpers";
import type { ThemeMode } from "./utils/theme-helpers";
import { APP_THEMES, DEFAULT_THEME } from "./utils/app-themes";
import { useTerminalOutputs } from "./hooks/useTerminalOutputs";
import { useWindowPersistence } from "./hooks/useWindowPersistence";
import { useLeftSidebarResize } from "./hooks/useLeftSidebarResize";
import { useRightSidebarResize } from "./hooks/useRightSidebarResize";
import { useGlobalClipboard } from "./hooks/useGlobalClipboard";
import { useNotifications } from "./hooks/useNotifications";
import { useFileUpload } from "./hooks/useFileUpload";
import { useAppStats } from "./hooks/useAppStats";
import { useCommandHistory } from "./hooks/useCommandHistory";
import "./App.css";

const LogViewer = lazy(() => import("./components/LogViewer"));

const MemoizedMenuBar = memo(MenuBar);

const AppContent: React.FC = () => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [isUncategorizedSelected, setIsUncategorizedSelected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSshImportOpen, setIsSshImportOpen] = useState(false);
  const [isBatchCommandOpen, setIsBatchCommandOpen] = useState(false);
  const [remoteLogServer, setRemoteLogServer] = useState<Server | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("server-pilot-welcomed") !== "1";
  });
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [initialCategoryId, setInitialCategoryId] = useState<string | undefined>(undefined);
  const [initialParentId, setInitialParentId] = useState<string | undefined>(undefined);
  const [editingCategory, setEditingCategory] = useState<Category | undefined>(undefined);
  const [editingServer, setEditingServer] = useState<Server | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<TerminalSession[]>([]);
  const serversRef = useRef<Server[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const generateDisplayId = (): string => {
    // 生成 6 位随机 base36 字符串作为终端唯一标识
    const arr = new Uint8Array(4);
    crypto.getRandomValues(arr);
    let num = 0;
    for (let i = 0; i < 4; i++) num = num * 256 + arr[i];
    return num.toString(36).padStart(6, '0').slice(0, 6).toUpperCase();
  };
  const [themeId, setThemeId] = useState<string>(getInitialThemeId);
  const theme: ThemeMode = getThemeMode(themeId);
  const [isTransferTrayOpen, setIsTransferTrayOpen] = useState(false);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptEvent | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const confirmOnDisconnectRef = useRef(true);
  const [commandHistoryServer, setCommandHistoryServer] = useState<Server | null | undefined>(undefined); // undefined=关闭, null=全部, Server=指定

  const { connectToServer, disconnectServer, closeTerminalSession, servers, categories, refreshCategories, refreshServers } = useServer();

  // Independent hooks
  const { terminalOutputs, appendTerminalChunk, resetTerminalOutput, removeTerminalOutputs } = useTerminalOutputs(sessionsRef);
  const { notify, notificationsEnabledRef } = useNotifications();
  const { uploadProgressOverlay, setUploadProgressOverlay, handleTerminalFilesDropped, removeSessionCurrentDirectories } = useFileUpload(servers, sessions, notify);
  const { setIsResizingLeftSidebar } = useLeftSidebarResize();
  const { setIsResizingRightSidebar } = useRightSidebarResize();
  const appStats = useAppStats();
  const { commands: commandHistory, addCommand, removeCommandsByServer, clearCommands } = useCommandHistory();

  useWindowPersistence();
  useGlobalClipboard();

  // Theme effect
  useEffect(() => {
    const currentTheme = APP_THEMES[themeId] ?? APP_THEMES[DEFAULT_THEME];
    applyTheme(currentTheme);
  }, [themeId]);

  // Fullscreen detection - use multiple methods
  useEffect(() => {
    const win = getCurrentWindow();
    let mounted = true;

    const checkFullscreen = async () => {
      try {
        // Try Tauri API first
        const fs = await win.isFullscreen();

        // Also check if window occupies full screen (macOS native fullscreen)
        const isNativeFullscreen = window.screenX === 0 && window.screenY === 0 &&
          window.outerWidth >= window.screen.availWidth &&
          window.outerHeight >= window.screen.availHeight;

        const isFs = fs || isNativeFullscreen;
        if (mounted) {
          setIsFullscreen(isFs);
          if (isFs) {
            setShowFullscreenHint(true);
            setTimeout(() => setShowFullscreenHint(false), 3000);
          }
        }
      } catch { /* ignore */ }
    };

    void checkFullscreen();

    // Listen for window events
    const unlistenResize = win.onResized(() => void checkFullscreen());
    const unlistenMove = win.onMoved(() => void checkFullscreen());

    // Also listen for web fullscreen API
    const handleFullscreenChange = () => {
      void checkFullscreen();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    // Poll as fallback
    const interval = setInterval(() => void checkFullscreen(), 200);

    return () => {
      mounted = false;
      void unlistenResize.then(fn => fn());
      void unlistenMove.then(fn => fn());
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      clearInterval(interval);
    };
  }, []);

  // ESC key to exit fullscreen — only when no modal/overlay is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isFullscreen) return;
      // 有模态框打开时不拦截 ESC，让模态框自己处理
      if (isCommandPaletteOpen || isSettingsOpen || isServerModalOpen || isCategoryModalOpen || editingServer || editingCategory) return;
      event.preventDefault();
      void getCurrentWindow().setFullscreen(false).then(() => setIsFullscreen(false));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, isCommandPaletteOpen, isSettingsOpen, isServerModalOpen, isCategoryModalOpen, editingServer, editingCategory]);

  // Welcome dismissal
  useEffect(() => {
    if (servers.length > 0) {
      setIsWelcomeOpen(false);
    }
  }, [servers.length]);

  // Command palette shortcut
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const handleCommandPaletteShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // 终端内不拦截 Ctrl+K，避免与 shell 的 kill-line 冲突
      if (isInsideTerminal(event.target as Element)) return;
      const hasPrimaryModifier = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (hasPrimaryModifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };

    window.addEventListener("keydown", handleCommandPaletteShortcut);
    return () => window.removeEventListener("keydown", handleCommandPaletteShortcut);
  }, []);

  // Load app settings
  useEffect(() => {
    void invoke<AppSettings>("get_app_settings")
      .then(setAppSettings)
      .catch(error => {
        console.error("加载应用设置失败:", error);
      });
  }, []);

  // Apply app settings
  useEffect(() => {
    if (!appSettings) {
      return;
    }

    notificationsEnabledRef.current = appSettings.notificationsEnabled;
    confirmOnDisconnectRef.current = appSettings.confirmOnDisconnect;

    if (appSettings.themePreference && APP_THEMES[appSettings.themePreference]) {
      setThemeId(appSettings.themePreference);
    } else if (appSettings.themePreference === "system") {
      const systemThemeId = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      setThemeId(systemThemeId);
    }
  }, [appSettings, notificationsEnabledRef]);

  // Sync refs
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { serversRef.current = servers; }, [servers]);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // Update session status helper
  const updateSessionStatus = useCallback((sessionId: string, status: TerminalSession["status"]) => {
    setSessions(prev => prev.map(session => (
      session.id === sessionId
        ? { ...session, status }
        : session
    )));
  }, []);

  // Session removal
  const applySessionRemoval = useCallback((sessionIds: string[], options: { preferredNextSessionId?: string | null; anchorSessionId?: string | null } = {}) => {
    if (sessionIds.length === 0) {
      return;
    }

    const removedIds = new Set(sessionIds);
    setSessions(prev => {
      const remainingSessions = reindexSessions(prev.filter(session => !removedIds.has(session.id)));
      const nextSessionId = resolveNextSessionId(prev, remainingSessions, currentSessionIdRef.current, options);

      setCurrentSessionId(nextSessionId);

      if (nextSessionId) {
        clearSelection();
        const nextSession = remainingSessions.find(session => session.id === nextSessionId) ?? null;
        const nextServer = nextSession
          ? serversRef.current.find(server => server.id === nextSession.serverId) ?? null
          : null;

        if (nextServer) {
          setActiveServer(nextServer);
        }
      } else {
        clearSelection();
      }

      return remainingSessions;
    });
    removeTerminalOutputs(sessionIds);
    removeSessionCurrentDirectories(sessionIds);
  }, [removeTerminalOutputs, removeSessionCurrentDirectories]);

  // Tauri event listeners
  useEffect(() => {
    const unlistenPromises: Array<Promise<() => void>> = [
      listen<[string, string]>("pty-data", (event) => {
        const [sessionId, chunk] = event.payload;
        appendTerminalChunk(sessionId, chunk);
      }),
      listen<[string, string]>("connection-log", (event) => {
        const [sessionId, message] = event.payload;
        appendTerminalChunk(sessionId, `[INFO] ${message}\r\n`);
      }),
      listen<TerminalSessionStatusEvent>("terminal-session-status-changed", (event) => {
        updateSessionStatus(event.payload.sessionId, event.payload.status);
      }),
      listen<TerminalSessionClosedEvent>("terminal-session-closed", (event) => {
        setHostKeyPrompt(prev => (prev && prev.sessionId === event.payload.sessionId ? null : prev));
        const serverName = serversRef.current.find(server => server.id === event.payload.serverId)?.name;
        if (event.payload.reason !== "manual") {
          notify("会话已断开", serverName ? `${serverName}：${event.payload.reason}` : event.payload.reason);
        }
        if (event.payload.reason === "connect-failed") {
          setConnectionError(event.payload.message ?? "连接失败，请检查网络与服务器状态");
        }
        if (event.payload.shouldRemove) {
          applySessionRemoval([event.payload.sessionId], { anchorSessionId: event.payload.sessionId });
          return;
        }
        updateSessionStatus(event.payload.sessionId, "disconnected");
      }),
      listen<FileTransferProgressEvent>("file-transfer-progress", (event) => {
        const payload = event.payload;
        setUploadProgressOverlay(prev => {
          if (!prev || prev.transferId !== payload.transferId) return prev;
          return {
            ...prev,
            status: payload.status === "progress" ? "uploading" : payload.status,
            progressPercent: payload.progressPercent,
            transferredBytes: payload.transferredBytes ?? prev.transferredBytes,
            totalBytes: payload.totalBytes ?? prev.totalBytes,
            bytesPerSecond: payload.bytesPerSecond ?? null,
            etaSeconds: payload.etaSeconds ?? null,
            message: payload.message ?? prev.message,
          };
        });
      }),
      listen<HostKeyPromptEvent>("host-key-prompt", (event) => {
        setHostKeyPrompt(event.payload);
      }),
    ];

    return () => {
      unlistenPromises.forEach(unlistenPromise => {
        unlistenPromise.then(unlisten => unlisten());
      });
    };
  }, [appendTerminalChunk, updateSessionStatus, setUploadProgressOverlay, applySessionRemoval, notify]);

  // Active server sync
  useEffect(() => {
    setActiveServer(prev => {
      if (!prev) return prev;
      return servers.find(server => server.id === prev.id) ?? prev;
    });
  }, [servers]);

  const currentSession = currentSessionId
    ? sessions.find(session => session.id === currentSessionId) ?? null
    : null;

  const transferTargetServer = activeServer ?? (currentSession
    ? servers.find(server => server.id === currentSession.serverId) ?? null
    : null);

  // --- Callbacks ---
  const clearSelection = useCallback(() => {
    setActiveServer(null);
    setActiveCategory(null);
    setIsUncategorizedSelected(false);
    setConnectionError(null);
  }, []);

  const handleSelectServer = useCallback((server: Server) => {
    clearSelection();
    setActiveServer(server);
  }, [clearSelection]);

  const handleConnectServer = useCallback(async (server: Server) => {
    clearSelection();
    setActiveServer(server);

    try {
      const result = await connectToServer(server.id);
      const displayId = generateDisplayId();
      setSessions(prev => reindexSessions([
        ...prev,
        { id: result.sessionId, serverId: server.id, terminalIndex: 0, displayId, status: "connecting", createdAt: Date.now() },
      ]));
      setCurrentSessionId(result.sessionId);
      resetTerminalOutput(result.sessionId, [`[信息] 正在连接 ${server.username}@${server.host}:${server.port} ...\r\n`]);
    } catch (err) {
      setConnectionError(err as string);
    }
  }, [clearSelection, connectToServer, resetTerminalOutput]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    // 乐观更新：先从 UI 移除
    const removedSession = sessionsRef.current.find(s => s.id === sessionId);
    applySessionRemoval([sessionId], { anchorSessionId: sessionId });
    try {
      await closeTerminalSession(sessionId);
    } catch (err) {
      console.error("关闭终端失败，恢复会话:", err);
      // 后端失败 — 恢复会话到 UI
      if (removedSession) {
        setSessions(prev => [...prev, removedSession]);
      }
    }
  }, [applySessionRemoval, closeTerminalSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    const selectedSession = sessions.find(session => session.id === sessionId) ?? null;
    const selectedServer = selectedSession
      ? servers.find(server => server.id === selectedSession.serverId) ?? null
      : null;

    clearSelection();
    if (selectedServer) setActiveServer(selectedServer);
    setCurrentSessionId(sessionId);
  }, [clearSelection, servers, sessions]);

  const handleDuplicateSession = useCallback((sessionId: string) => {
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;
    const server = servers.find(item => item.id === session.serverId);
    if (!server) return;
    void handleConnectServer(server);
  }, [handleConnectServer, servers, sessions]);

  const handleCloseSessionsToLeft = useCallback((sessionId: string) => {
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    if (sessionIndex <= 0) return;
    const targetSessionIds = sessions.slice(0, sessionIndex).map(session => session.id);
    targetSessionIds.forEach(id => { closeTerminalSession(id).catch(err => console.error("关闭左侧终端失败:", err)); });
    applySessionRemoval(targetSessionIds, { preferredNextSessionId: sessionId, anchorSessionId: sessionId });
  }, [applySessionRemoval, closeTerminalSession, sessions]);

  const handleCloseSessionsToRight = useCallback((sessionId: string) => {
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    if (sessionIndex < 0 || sessionIndex >= sessions.length - 1) return;
    const targetSessionIds = sessions.slice(sessionIndex + 1).map(session => session.id);
    targetSessionIds.forEach(id => { closeTerminalSession(id).catch(err => console.error("关闭右侧终端失败:", err)); });
    applySessionRemoval(targetSessionIds, { preferredNextSessionId: sessionId, anchorSessionId: sessionId });
  }, [applySessionRemoval, closeTerminalSession, sessions]);

  const handleCloseServerSessions = useCallback((sessionId: string) => {
    const targetSession = sessions.find(session => session.id === sessionId);
    if (!targetSession) return;
    const targetSessionIds = sessions.filter(session => session.serverId === targetSession.serverId).map(session => session.id);
    if (targetSessionIds.length === 0) return;
    disconnectServer(targetSession.serverId).catch(err => console.error("关闭当前服务器所有终端失败:", err));
    applySessionRemoval(targetSessionIds, { anchorSessionId: sessionId });
  }, [applySessionRemoval, disconnectServer, sessions]);

  const handleCloseAllSessions = useCallback(() => {
    if (sessions.length === 0) return;
    const targetSessionIds = sessions.map(session => session.id);
    const relatedServerIds = Array.from(new Set(sessions.map(session => session.serverId)));
    relatedServerIds.forEach(serverId => { disconnectServer(serverId).catch(err => console.error("关闭所有终端失败:", err)); });
    applySessionRemoval(targetSessionIds, { anchorSessionId: currentSessionId });
  }, [applySessionRemoval, currentSessionId, disconnectServer, sessions]);

  const handleReconnectSession = useCallback((sessionId: string) => {
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;
    const server = servers.find(item => item.id === session.serverId);
    if (!server) return;
    void handleConnectServer(server);
  }, [handleConnectServer, servers, sessions]);

  const handleTerminalCommandExecuted = useCallback((sessionId: string, command: string) => {
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session) return;
    const server = serversRef.current.find(s => s.id === session.serverId);
    addCommand(sessionId, session.displayId, session.serverId, server?.name ?? '未知服务器', command);
  }, [addCommand]);

  const handleSelectCategory = useCallback((category: Category | null) => {
    clearSelection();
    setActiveCategory(category);
    setIsUncategorizedSelected(category === null);
  }, [clearSelection]);

  const handleDisconnectServer = useCallback(async (server: Server) => {
    if (confirmOnDisconnectRef.current) {
      const confirmed = await confirm(
        `确定要断开 ${server.name}（${server.username}@${server.host}:${server.port}）的连接吗？`,
        "断开连接",
      );
      if (!confirmed) return;
    }

    // 用 sessionsRef 获取最新数据，避免闭包过时
    const relatedSessions = sessionsRef.current.filter(session => session.serverId === server.id);
    if (relatedSessions.length > 0) {
      applySessionRemoval(relatedSessions.map(session => session.id), { anchorSessionId: currentSessionId });
      disconnectServer(server.id).catch(err => console.error("断开连接失败:", err));
      return;
    }

    try {
      await disconnectServer(server.id);
    } catch (err) {
      console.error("断开连接失败:", err);
    }
  }, [applySessionRemoval, currentSessionId, disconnectServer]);

  const handleEditServerSaved = useCallback((updatedServer: Server) => {
    setActiveServer(prev => (prev?.id === updatedServer.id ? updatedServer : prev));
    setEditingServer(undefined);
  }, []);

  const handleDeleteServer = useCallback(async (server: Server) => {
    const confirmed = await confirm(`确定要删除服务器「${server.name}」吗？此操作不可撤销。`, { title: "删除服务器", kind: "warning" });
    if (!confirmed) return;
    try {
      await invoke("delete_server", { id: server.id });
      setActiveServer(prev => (prev?.id === server.id ? null : prev));
      setSessions(prev => {
        const remaining = prev.filter(s => s.serverId !== server.id);
        // 在同一个 updater 内计算 nextSessionId，避免闭包过时
        setCurrentSessionId(currentPrev => {
          if (currentPrev && prev.find(s => s.id === currentPrev)?.serverId === server.id) {
            return remaining[0]?.id ?? null;
          }
          return currentPrev;
        });
        return remaining;
      });
    } catch (error) {
      console.error("删除服务器失败:", error);
    }
  }, []);

  const handleDeleteCategory = useCallback(async (category: Category) => {
    const confirmed = await confirm(`确定要删除分类「${category.name}」吗？其中的服务器将变为未分类。`, { title: "删除分类", kind: "warning" });
    if (!confirmed) return;
    try {
      await invoke("delete_category", { id: category.id, moveToUncategorized: true });
      await refreshCategories();
      await refreshServers();
    } catch (error) {
      console.error("删除分类失败:", error);
    }
  }, [refreshCategories, refreshServers]);

  const handleEditCategory = useCallback((category: Category) => {
    setEditingCategory(category);
    setIsCategoryModalOpen(true);
  }, []);

  const handleCategoryContextMenu = useCallback((event: React.MouseEvent, category: Category | null) => {
    const actions: ContextMenuAction[] = [
      { label: "新建服务器", icon: <FaPlus />, action: () => { setEditingServer(undefined); setInitialCategoryId(category?.id); setIsServerModalOpen(true); }},
      { label: "新建子分类", icon: <FaFolderPlus />, action: () => { setEditingCategory(undefined); setInitialParentId(category?.id); setIsCategoryModalOpen(true); }}
    ];
    if (category) {
      actions.push(
        { label: "编辑分类", icon: <FaEdit />, action: () => { setEditingCategory(category); setIsCategoryModalOpen(true); }},
        { label: "删除分类", icon: <FaTrash />, action: () => { void handleDeleteCategory(category); }}
      );
    }
    setContextMenu({ x: event.clientX, y: event.clientY, actions });
  }, [handleDeleteCategory]);

  const handleServerContextMenu = useCallback((event: React.MouseEvent, server: Server) => {
    const actions: ContextMenuAction[] = [
      { label: server.status === 'connected' ? "打开终端" : "连接服务器", icon: <FaPlug />, action: () => { handleConnectServer(server); }},
      { label: "编辑", icon: <FaEdit />, action: () => { setEditingServer(server); setInitialCategoryId(server.categoryId); setIsServerModalOpen(true); }}
    ];

    if (server.status === 'connected' || server.status === 'connecting') {
      actions.push({ label: "断开连接", icon: <FaUnlink />, action: () => { handleDisconnectServer(server); }});
    }

    actions.push({ label: "删除服务器", icon: <FaTrash />, action: () => { void handleDeleteServer(server); }});

    setContextMenu({ x: event.clientX, y: event.clientY, actions });
  }, [handleConnectServer, handleDisconnectServer, handleDeleteServer]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const handleNewCategory = useCallback(() => { setEditingCategory(undefined); setInitialParentId(undefined); setIsCategoryModalOpen(true); }, []);
  const handleNewServer = useCallback(() => { setEditingServer(undefined); setInitialCategoryId(undefined); setIsServerModalOpen(true); }, []);
  const handleOpenSshImport = useCallback(() => setIsSshImportOpen(true), []);
  const handleOpenBatchCommand = useCallback(() => setIsBatchCommandOpen(true), []);
  const handleOpenRemoteLog = useCallback((server: Server) => setRemoteLogServer(server), []);
  const dismissWelcome = useCallback(() => { window.localStorage.setItem("server-pilot-welcomed", "1"); setIsWelcomeOpen(false); }, []);
  const handleOpenSettings = useCallback(() => { setIsLogViewerOpen(false); setIsSettingsOpen(true); }, []);
  const handleOpenLogViewer = useCallback(() => setIsLogViewerOpen(true), []);
  const handleCreateServerInCategory = useCallback((category: Category | null) => { setEditingServer(undefined); setInitialCategoryId(category?.id); setIsServerModalOpen(true); }, []);
  const handleCreateSubCategory = useCallback((category: Category | null) => { setEditingCategory(undefined); setInitialParentId(category?.id); setIsCategoryModalOpen(true); }, []);

  const handleToggleTheme = useCallback(() => {
    // 在深色和浅色主题之间切换
    const currentTheme = APP_THEMES[themeId];
    const nextThemeId = currentTheme?.type === 'dark' ? 'light' : 'dark';
    setThemeId(nextThemeId);
    setAppSettings(prev => {
      if (!prev) return prev;
      const nextSettings: AppSettings = { ...prev, themePreference: nextThemeId };
      void invoke("update_app_settings", { payload: nextSettings }).catch(error => { console.error("保存主题设置失败:", error); });
      return nextSettings;
    });
  }, [themeId]);

  const handleChangeTheme = useCallback((newThemeId: string) => {
    setThemeId(newThemeId);
    setAppSettings(prev => {
      if (!prev) return prev;
      const nextSettings: AppSettings = { ...prev, themePreference: newThemeId };
      void invoke("update_app_settings", { payload: nextSettings }).catch(error => { console.error("保存主题设置失败:", error); });
      return nextSettings;
    });
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      // Use current state instead of querying
      await win.setFullscreen(!isFullscreen);
      setIsFullscreen(!isFullscreen);
      if (!isFullscreen) {
        setShowFullscreenHint(true);
        setTimeout(() => setShowFullscreenHint(false), 3000);
      }
    } catch (e) {
      console.error("切换全屏失败:", e);
    }
  }, [isFullscreen]);

  const handleTerminalFontSizeChange = useCallback((delta: number) => {
    setAppSettings(prev => {
      if (!prev) return prev;
      const nextFontSize = delta === 0 ? 14 : Math.min(24, Math.max(12, prev.terminalFontSize + delta));
      if (nextFontSize === prev.terminalFontSize) return prev;
      const next = { ...prev, terminalFontSize: nextFontSize };
      void invoke("update_app_settings", { payload: next }).catch(error => { console.error("保存终端字体设置失败:", error); });
      return next;
    });
  }, []);

  const handleDismissError = useCallback(() => setConnectionError(null), []);
  const handleCloseLogViewer = useCallback(() => setIsLogViewerOpen(false), []);
  const toggleLeftSidebar = useCallback(() => { setIsLeftSidebarOpen(prev => !prev); }, []);
  const toggleRightSidebar = useCallback(() => {
    setIsRightSidebarOpen(prev => !prev);
    setIsTransferTrayOpen(false);
  }, []);

  const handleOpenCommandHistory = useCallback((server?: Server) => {
    setCommandHistoryServer(server ?? null);
  }, []);
  const toggleTransferTray = useCallback(() => {
    setIsTransferTrayOpen(prev => !prev);
    setIsRightSidebarOpen(false);
  }, []);

  // Context menu outside click
  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
    };
  }, [contextMenu, closeContextMenu]);

  return (
    <div className="app-wrapper">
      <MemoizedMenuBar
        onNewCategory={handleNewCategory}
        onNewServer={handleNewServer}
        onImportSshConfig={handleOpenSshImport}
        onBatchCommand={handleOpenBatchCommand}
        onOpenSettings={handleOpenSettings}
        onViewLogs={handleOpenLogViewer}
        theme={theme}
        themeId={themeId}
        onToggleTheme={handleToggleTheme}
        onChangeTheme={handleChangeTheme}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />
      {isFullscreen && showFullscreenHint && (
        <div className="fullscreen-hint">
          按 ESC 退出全屏
        </div>
      )}
      <div className="content-wrapper">
        <LeftSidebar
          isOpen={isLeftSidebarOpen}
          activeServer={activeServer}
          activeCategory={activeCategory}
          isUncategorizedActive={isUncategorizedSelected}
          onSelectServer={handleSelectServer}
          onSelectCategory={handleSelectCategory}
          onCategoryContextMenu={handleCategoryContextMenu}
          onCreateServer={handleCreateServerInCategory}
          onCreateSubCategory={handleCreateSubCategory}
          onEditCategory={handleEditCategory}
          onConnectServer={handleConnectServer}
          onDisconnectServer={handleDisconnectServer}
          onOpenCommandHistory={handleOpenCommandHistory}
          onServerContextMenu={handleServerContextMenu}
        />
        {isLeftSidebarOpen && (
          <div
            className="left-sidebar-resizer"
            onPointerDown={(event) => { event.preventDefault(); setIsResizingLeftSidebar(true); }}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整服务器列表宽度"
          />
        )}
        <div className="workspace-shell">
          <MainContent
            sessions={sessions}
            servers={servers}
            currentSessionId={currentSessionId}
            terminalOutputs={terminalOutputs}
            onSelectSession={handleSelectSession}
            onCloseSession={handleCloseSession}
            onDuplicateSession={handleDuplicateSession}
            onCloseSessionsToLeft={handleCloseSessionsToLeft}
            onCloseSessionsToRight={handleCloseSessionsToRight}
            onCloseServerSessions={handleCloseServerSessions}
            onCloseAllSessions={handleCloseAllSessions}
            onTerminalFilesDropped={handleTerminalFilesDropped}
            onTerminalCommandExecuted={handleTerminalCommandExecuted}
            terminalFontSize={appSettings?.terminalFontSize ?? 14}
            terminalScrollback={appSettings?.terminalScrollback ?? 5000}
            onTerminalFontSizeChange={handleTerminalFontSizeChange}
            onReconnectSession={handleReconnectSession}
            disconnectMessage={connectionError}
          />
          {!isLogViewerOpen && isRightSidebarOpen && (
            <div className="right-sidebar-overlay">
              <div
                className="right-sidebar-resizer"
                onPointerDown={(event) => { event.preventDefault(); setIsResizingRightSidebar(true); }}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整服务器详情宽度"
              />
              <RightSidebar
                isOpen={true}
                activeServer={activeServer}
                activeCategory={activeCategory}
                isUncategorizedSelected={isUncategorizedSelected}
                connectionError={connectionError}
                onConnectServer={handleConnectServer}
                onDisconnectServer={handleDisconnectServer}
                onDeleteServer={handleDeleteServer}
                onDismissError={handleDismissError}
                onViewLogs={handleOpenRemoteLog}
              />
            </div>
          )}
        </div>
      </div>
      <FileTransferTray isOpen={isTransferTrayOpen} server={transferTargetServer} onClose={toggleTransferTray} />
      <BottomBar
        isLeftSidebarOpen={isLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        isTransferTrayOpen={isTransferTrayOpen}
        toggleLeftSidebar={toggleLeftSidebar}
        toggleRightSidebar={toggleRightSidebar}
        toggleTransferTray={toggleTransferTray}
        onOpenCommandHistory={handleOpenCommandHistory}
        terminalCount={sessions.length}
        serverCount={servers.length}
        appStats={appStats}
      />
      {uploadProgressOverlay && <UploadProgressToast overlay={uploadProgressOverlay} />}
      {isSettingsOpen && (
        <Settings onClose={() => setIsSettingsOpen(false)} />
      )}
      {isLogViewerOpen && (
        <Suspense fallback={null}>
          <LogViewer onClose={handleCloseLogViewer} />
        </Suspense>
      )}
      {isServerModalOpen && (
        <AddServerModal
          onClose={() => { setIsServerModalOpen(false); setEditingServer(undefined); }}
          initialCategoryId={initialCategoryId}
          existingServer={editingServer}
          onSaved={handleEditServerSaved}
        />
      )}
      {isSshImportOpen && <ImportSshConfigModal onClose={() => setIsSshImportOpen(false)} />}
      {isBatchCommandOpen && (
        <BatchCommandModal sessions={sessions} servers={servers} onClose={() => setIsBatchCommandOpen(false)} />
      )}
      {remoteLogServer && (
        <RemoteLogModal server={remoteLogServer} onClose={() => setRemoteLogServer(null)} />
      )}
      {isCategoryModalOpen && <AddCategoryModal onClose={() => { setIsCategoryModalOpen(false); setEditingCategory(undefined); }} parentId={initialParentId} editCategory={editingCategory} />}
      {hostKeyPrompt && (
        <HostKeyPromptModal
          prompt={hostKeyPrompt}
          servers={servers}
          onClose={() => setHostKeyPrompt(null)}
        />
      )}
      {isWelcomeOpen && servers.length === 0 && (
        <WelcomeModal
          onAddServer={() => { handleNewServer(); dismissWelcome(); }}
          onImportSshConfig={() => { handleOpenSshImport(); dismissWelcome(); }}
          onDismiss={dismissWelcome}
        />
      )}
      {isCommandPaletteOpen && (
        <CommandPalette
          servers={servers}
          categories={categories}
          onConnectServer={handleConnectServer}
          onSelectCategory={handleSelectCategory}
          onNewServer={handleNewServer}
          onNewCategory={handleNewCategory}
          onOpenSettings={handleOpenSettings}
          onClose={() => setIsCommandPaletteOpen(false)}
        />
      )}
      {contextMenu && <ContextMenu {...contextMenu} menuRef={contextMenuRef} onClose={closeContextMenu} />}
      {commandHistoryServer !== undefined && (
        <CommandHistoryModal
          commands={commandHistory}
          servers={servers}
          categories={categories}
          initialServerId={commandHistoryServer && commandHistoryServer !== null ? commandHistoryServer.id : undefined}
          onClose={() => setCommandHistoryServer(undefined)}
          onClear={(serverId) => serverId ? removeCommandsByServer(serverId) : clearCommands()}
        />
      )}
    </div>
  );
};

function App() {
  return (
    <ServerProvider>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </ServerProvider>
  );
}

export default App;
