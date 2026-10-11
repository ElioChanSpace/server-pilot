import React, { useState, useRef, useEffect, useCallback, memo, Suspense, lazy } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
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
import { getErrorMessage } from "./utils/format-helpers";
import { ContextMenu, isEventInsideContextMenu } from "./components/ContextMenu";
import type { ContextMenuAction } from "./components/ContextMenu";
import { MenuBar } from "./components/MenuBar";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { UploadProgressToast } from "./components/UploadProgressToast";
import { HostKeyPromptModal } from "./components/HostKeyPromptModal";
import { CommandHistoryModal } from "./components/CommandHistoryModal";
import { PortMonitorModal } from "./components/PortMonitorModal";
import { DockerManagerModal } from "./components/DockerManagerModal";
import { ProcessManagerModal } from "./components/ProcessManagerModal";
import { DiskAnalysisModal } from "./components/DiskAnalysisModal";
import { SystemInfoModal } from "./components/SystemInfoModal";
import { NetConnectionsModal } from "./components/NetConnectionsModal";
import { LogStreamModal } from "./components/LogStreamModal";
import { ScheduledTasksModal } from "./components/ScheduledTasksModal";
import { MetricsHistoryModal } from "./components/MetricsHistoryModal";
import { FileManagerModal } from "./components/FileManagerModal";
import { ServiceManagerModal } from "./components/ServiceManagerModal";
import { TransferHistoryModal } from "./components/TransferHistoryModal";
import { useTransferHistory } from "./hooks/useTransferHistory";
import { FaEdit, FaPlus, FaFolderPlus, FaPlug, FaUnlink, FaTrash } from "react-icons/fa";
import type { TerminalSession, TerminalSessionClosedEvent, TerminalSessionStatusEvent, TerminalSessionSummary } from "./types/terminal";
import type { AppSettings } from "./types/settings";
import type { ContextMenuState, HostKeyPromptEvent, FileTransferProgressEvent } from "./types/app";
import { reindexSessions, resolveNextSessionId } from "./utils/session-helpers";
import {
  loadStoredSessions,
  saveStoredSessions,
  clearStoredSessions,
  reconcileSessions,
} from "./utils/session-restore";
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
  const appSettingsRef = useRef<AppSettings | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const confirmOnDisconnectRef = useRef(true);
  const [commandHistoryServer, setCommandHistoryServer] = useState<Server | null | undefined>(undefined); // undefined=关闭, null=全部, Server=指定
  const [toolboxTarget, setToolboxTarget] = useState<{ tool: import("./components/TabBar").ToolboxTool; id: string; name: string } | null>(null);

  const { connectToServer, disconnectServer, closeTerminalSession, servers, categories, refreshCategories, refreshServers } = useServer();

  // Independent hooks
  const { terminalOutputs, appendTerminalChunk, resetTerminalOutput, removeTerminalOutputs } = useTerminalOutputs(sessionsRef);
  const terminalOutputsRef = useRef(terminalOutputs);
  useEffect(() => {
    terminalOutputsRef.current = terminalOutputs;
  }, [terminalOutputs]);

  // Remote status badges per tab (cwd / git branch / load) — polled while sessions are connected
  const [tabStatuses, setTabStatuses] = useState<Record<string, import("./components/TabBar").TabRemoteStatus>>({});
  const tabPollBusyRef = useRef(false);

  // ── A: 终端 ↔ 文件面板路径联动 ──
  // 跟随开关（全局模式）：开启后文件面板始终跟随"活动终端"的目录
  const [followCwdEnabled, setFollowCwdEnabled] = useState(
    () => window.localStorage.getItem("server-pilot-follow-cwd") !== "0",
  );
  const followCwdRef = useRef(followCwdEnabled);
  followCwdRef.current = followCwdEnabled;
  // 每会话已知 cwd（cd 探测/切换时查询），避免重复注入探测命令
  const sessionCwdMapRef = useRef(new Map<string, string>());
  // cd 后探测的去抖定时器（per session）
  const cdProbeTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    window.localStorage.setItem("server-pilot-follow-cwd", followCwdEnabled ? "1" : "0");
  }, [followCwdEnabled]);

  /** 统一的 cwd 汇聚点：更新缓存 + 通知面板（仅活动会话 + 跟随开启时） */
  const publishTerminalCwd = useCallback((sessionId: string, cwd: string) => {
    if (!cwd) return;
    sessionCwdMapRef.current.set(sessionId, cwd);
    void invoke<boolean>("set_terminal_session_cwd", { sessionId, cwd }).catch(() => {});
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session || session.id !== currentSessionIdRef.current) return;
    if (!followCwdRef.current) return;
    void emit("terminal-cwd-changed", { sessionId, serverId: session.serverId, cwd });
  }, []);

  // 切换终端标签 → 面板跟随该会话的已知目录
  useEffect(() => {
    if (!currentSessionId || !followCwdEnabled) return;
    const cwd = sessionCwdMapRef.current.get(currentSessionId);
    if (cwd) {
      const session = sessionsRef.current.find(s => s.id === currentSessionId);
      if (session) {
        void emit("terminal-cwd-changed", {
          sessionId: currentSessionId,
          serverId: session.serverId,
          cwd,
        });
      }
    }
  }, [currentSessionId, followCwdEnabled]);
  useEffect(() => {
    const poll = async () => {
      if (tabPollBusyRef.current) return;
      tabPollBusyRef.current = true;
      try {
        for (const session of sessionsRef.current) {
          if (session.status !== 'connected') continue;
          try {
            const status = await invoke<import("./components/TabBar").TabRemoteStatus>('fetch_tab_status', {
              id: session.serverId,
              sessionId: session.id,
            });
            setTabStatuses(prev => ({ ...prev, [session.id]: status }));
          } catch { /* 会话可能刚断开 */ }
        }
      } finally {
        tabPollBusyRef.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 45_000);
    return () => clearInterval(timer);
  }, [sessions]);
  const { notify, notificationsEnabledRef } = useNotifications();
  const { uploadProgressOverlay, setUploadProgressOverlay, handleTerminalFilesDropped, removeSessionCurrentDirectories } = useFileUpload(servers, sessions, notify);
  const { setIsResizingLeftSidebar } = useLeftSidebarResize();
  const { setIsResizingRightSidebar } = useRightSidebarResize();
  const appStats = useAppStats();
  const { commands: commandHistory, addCommand, removeCommandsByServer, clearCommands } = useCommandHistory();
  const { records: transferRecords, addRecord: addTransferRecord, removeRecord: removeTransferRecord, removeRecords: removeTransferRecords, clearHistory: clearTransferHistory } = useTransferHistory();
  const [isTransferHistoryOpen, setIsTransferHistoryOpen] = useState(false);
  const transferStartTimes = useRef<Map<string, number>>(new Map());
  const transferMeta = useRef<Map<string, { direction: string; localPath: string; remotePath: string; totalBytes: number; serverName: string }>>(new Map());

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
    let hintTimer: number | null = null;

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
            // Show the hint once per fullscreen session with a single timer.
            setShowFullscreenHint(true);
            if (hintTimer !== null) {
              window.clearTimeout(hintTimer);
            }
            hintTimer = window.setTimeout(() => {
              hintTimer = null;
              if (mounted) {
                setShowFullscreenHint(false);
              }
            }, 3000);
          } else {
            if (hintTimer !== null) {
              window.clearTimeout(hintTimer);
              hintTimer = null;
            }
            setShowFullscreenHint(false);
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

    return () => {
      mounted = false;
      if (hintTimer !== null) {
        window.clearTimeout(hintTimer);
      }
      void unlistenResize.then(fn => fn());
      void unlistenMove.then(fn => fn());
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
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
      .then(settings => {
        appSettingsRef.current = settings;
        setAppSettings(settings);
      })
      .catch(error => {
        console.error("加载应用设置失败:", error);
      });
  }, []);

  // Persist settings outside of any setState updater (updaters must be pure —
  // in StrictMode they run twice, which would double the IPC calls).
  const persistAppSettings = useCallback((next: AppSettings) => {
    appSettingsRef.current = next;
    setAppSettings(next);
    void invoke("update_app_settings", { payload: next }).catch(error => {
      console.error("保存应用设置失败:", error);
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

  // 会话元数据持久化：tab 信息随会话变化落盘，供刷新后恢复。
  // 必须等启动对账完成后再开始保存，否则挂载时的空列表会先把存储抹掉。
  const sessionsHydratedRef = useRef(false);
  useEffect(() => {
    if (!sessionsHydratedRef.current) return;
    saveStoredSessions(sessions);
  }, [sessions]);

  // P0: UI 刷新后恢复会话 —— 后端 PTY 仍存活，枚举后与本地元数据对账重建 tab。
  // 等设置加载完成后按 restoreSessionsOnLaunch 决定恢复 or 关闭全部。
  //
  // StrictMode 注意：挂载时 effect 会执行两遍（第一遍随后被"模拟卸载"清理），
  // 因此这里不能用 cleanup 中止异步（否则第一遍被掐死、第二遍又被前置位挡住，
  // 恢复逻辑永远不执行）。改为：启动前置位防重入 + 异步体不提供中止路径。
  const restoreInFlightRef = useRef(false);
  useEffect(() => {
    if (!appSettings || restoreInFlightRef.current) return;
    restoreInFlightRef.current = true;

    if (appSettings.restoreSessionsOnLaunch === false) {
      // 不恢复 = 刷新即断开：清理后台会话与残留元数据，杜绝孤儿 PTY
      void invoke<number>("close_all_terminal_sessions").catch(() => {});
      clearStoredSessions();
      sessionsHydratedRef.current = true;
      return;
    }

    void (async () => {
      try {
        // 幂等护栏：已有 tab（如极端情况下的重复触发）则不再覆盖
        if (sessionsRef.current.length > 0) return;
        const alive = await invoke<TerminalSessionSummary[]>("list_terminal_sessions");
        if (alive.length > 0) {
          const restored = reconcileSessions(alive, loadStoredSessions());
          if (restored.length > 0) {
            // P1: 先取历史输出快照，再一次性恢复 tab + 回放
            const snapshots = await Promise.all(
              restored.map(s =>
                invoke<string>("get_terminal_session_output", { sessionId: s.id }).catch(() => ""),
              ),
            );
            const reindexed = reindexSessions(restored);
            sessionsRef.current = reindexed;
            setSessions(reindexed);
            restored.forEach((s, i) => {
              const output = snapshots[i];
              if (output) {
                resetTerminalOutput(s.id, [
                  "[INFO] 终端会话已恢复，以下为刷新前的历史输出\r\n",
                  output,
                ]);
              }
            });
            if (currentSessionIdRef.current == null) {
              setCurrentSessionId(reindexed[0].id);
            }
            notify(
              "终端会话已恢复",
              `刷新前的 ${reindexed.length} 个终端连接仍在后台运行，已重新接入`,
            );
          }
        }
      } catch (err) {
        console.error("恢复终端会话失败:", err);
      } finally {
        // 无条件水合：此前被中止门槛挡住导致元数据从未落盘
        sessionsHydratedRef.current = true;
        // 以当前列表为准落盘（含恢复出的 displayId），并清理死亡会话的残留
        saveStoredSessions(sessionsRef.current);
      }
    })();
    // 仅在设置首次加载后执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings]);

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

  const currentSession = currentSessionId
    ? sessions.find(session => session.id === currentSessionId) ?? null
    : null;

  const transferTargetServer = activeServer ?? (currentSession
    ? servers.find(server => server.id === currentSession.serverId) ?? null
    : null);

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

        // Track start time and metadata for history
        if (payload.status === "preparing") {
          transferStartTimes.current.set(payload.transferId, Date.now());
          transferMeta.current.set(payload.transferId, {
            direction: payload.direction,
            localPath: payload.localPath,
            remotePath: payload.remotePath,
            totalBytes: payload.totalBytes ?? 0,
            // Resolve from the transfer's own server id — never from whatever
            // server the UI happens to have selected right now.
            serverName: serversRef.current.find(server => server.id === payload.serverId)?.name ?? "",
          });
        }

        // Record completed/failed transfers to history
        if (payload.status === "completed" || payload.status === "failed") {
          const startTime = transferStartTimes.current.get(payload.transferId) ?? Date.now();
          const meta = transferMeta.current.get(payload.transferId);
          const completedAt = Date.now();
          const serverName = meta?.serverName ?? "";

          addTransferRecord({
            id: payload.transferId,
            direction: (meta?.direction ?? payload.direction) as "upload" | "download",
            fileName: payload.remotePath.split("/").pop() || payload.localPath.split(/[\\/]/).pop() || "file",
            localPath: meta?.localPath ?? payload.localPath,
            remotePath: meta?.remotePath ?? payload.remotePath,
            serverName,
            totalBytes: meta?.totalBytes ?? payload.totalBytes ?? 0,
            transferredBytes: payload.transferredBytes ?? meta?.totalBytes ?? 0,
            averageSpeed: payload.bytesPerSecond ?? 0,
            startedAt: startTime,
            completedAt,
            duration: completedAt - startTime,
            status: payload.status === "completed" ? "completed" : "failed",
            error: payload.status === "failed" ? (payload.message ?? undefined) : undefined,
          });
          transferStartTimes.current.delete(payload.transferId);
          transferMeta.current.delete(payload.transferId);
        }

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
    // Global listeners register exactly once. All values read inside handlers
    // come from refs or are stable useCallbacks — depending on anything
    // rendered (e.g. the selected server) would tear down/re-register the
    // listeners on every selection change and drop events in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Active server sync
  useEffect(() => {
    setActiveServer(prev => {
      if (!prev) return prev;
      return servers.find(server => server.id === prev.id) ?? prev;
    });
  }, [servers]);

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
      // 每次连接都是新会话（后端 UUID 唯一）—— 同一服务器可开多个终端；
      // 刷新恢复走 list_terminal_sessions 重绑，不经过此路径。
      const displayId = generateDisplayId();
      const newSession: TerminalSession = { id: result.sessionId, serverId: server.id, terminalIndex: 0, displayId, status: "connecting", createdAt: Date.now() };
      // Make the session visible to the output pipeline immediately so chunks
      // arriving before the next render are not silently dropped.
      sessionsRef.current = [...sessionsRef.current, newSession];
      setSessions(prev => reindexSessions([
        ...prev,
        newSession,
      ]));
      setCurrentSessionId(result.sessionId);
      resetTerminalOutput(result.sessionId, [`[信息] 正在连接 ${server.username}@${server.host}:${server.port} ...\r\n`]);
    } catch (err) {
      setConnectionError(getErrorMessage(err));
    }
  }, [clearSelection, connectToServer, resetTerminalOutput]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    // 乐观更新：先从 UI 移除，但保留快照以便失败时完整恢复
    const removedIndex = sessionsRef.current.findIndex(s => s.id === sessionId);
    const removedSession = removedIndex >= 0 ? sessionsRef.current[removedIndex] : undefined;
    const savedOutputs = terminalOutputsRef.current[sessionId];
    applySessionRemoval([sessionId], { anchorSessionId: sessionId });
    try {
      await closeTerminalSession(sessionId);
    } catch (err) {
      console.error("关闭终端失败，恢复会话:", err);
      // 后端失败 — 恢复会话（含历史输出）到原来的位置
      if (removedSession) {
        const restore = (list: TerminalSession[]) => {
          const next = [...list];
          next.splice(Math.min(removedIndex, next.length), 0, removedSession);
          return next;
        };
        sessionsRef.current = restore(sessionsRef.current);
        setSessions(prev => restore(prev));
      }
      if (savedOutputs) {
        resetTerminalOutput(sessionId, savedOutputs.chunks);
      }
    }
  }, [applySessionRemoval, closeTerminalSession, resetTerminalOutput]);

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

    // A: 目录变更命令（cd/pushd/popd）→ 安全探测真实 cwd。
    // 延后 200ms 再注入探测（确保用户的回车已被 PTY 处理），并按会话
    // 去抖（OSC133 与本地跟踪可能双触发），绝不与用户命令行拼接。
    if (/^\s*(cd|pushd|popd)\b/.test(command)) {
      const pending = cdProbeTimersRef.current;
      const existing = pending.get(sessionId);
      if (existing !== undefined) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        pending.delete(sessionId);
        void invoke<string>("get_terminal_session_directory", { sessionId })
          .then(cwd => publishTerminalCwd(sessionId, cwd))
          .catch(() => {});
      }, 200);
      pending.set(sessionId, timer);
    }
  }, [addCommand, publishTerminalCwd]);

  /** 面板 → 终端：在活动终端中 cd 到指定目录 */
  const handleCdInTerminal = useCallback((serverId: string, path: string) => {
    const session =
      sessionsRef.current.find(s => s.serverId === serverId && s.id === currentSessionIdRef.current) ??
      sessionsRef.current.find(s => s.serverId === serverId && s.status === "connected");
    if (!session) return;
    void invoke("pty_write", {
      sessionId: session.id,
      data: `cd ${JSON.stringify(path)}\r`,
    }).catch(() => {});
  }, []);

  // B1: 标签拖拽重排 / 元数据（固定/配色/别名）更新
  const handleReorderSessions = useCallback((ordered: TerminalSession[]) => {
    setSessions(reindexSessions(ordered));
  }, []);

  const handleUpdateSessionMeta = useCallback(
    (sessionId: string, patch: Partial<TerminalSession>) => {
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, ...patch } : s)));
    },
    [],
  );

  // B2: 终端分屏 —— 新建同组会话（新 PTY）加入当前标签
  const handleSplitSession = useCallback(
    async (sessionId: string, layout: 'row' | 'column') => {
      const source = sessionsRef.current.find(s => s.id === sessionId);
      if (!source) return;
      try {
        const result = await connectToServer(source.serverId);
        // connect 复用保护：同 id 已存在则忽略（分屏要求新会话）
        if (sessionsRef.current.some(s => s.id === result.sessionId)) return;
        const groupId = source.groupId ?? source.id;
        const newSession: TerminalSession = {
          id: result.sessionId,
          serverId: source.serverId,
          terminalIndex: 0,
          displayId: generateDisplayId(),
          status: 'connecting',
          createdAt: Date.now(),
          groupId,
          paneLayout: layout,
          paneRatio: 1,
        };
        const next = sessionsRef.current.map(s =>
          s.id === sessionId || s.groupId === groupId
            ? { ...s, groupId, paneLayout: layout, paneRatio: s.paneRatio ?? 1 }
            : s,
        );
        const all = reindexSessions([...next, newSession]);
        sessionsRef.current = all;
        setSessions(all);
        setCurrentSessionId(result.sessionId);
        resetTerminalOutput(result.sessionId, [
          `[信息] 分屏会话已启动\r\n`,
        ]);
      } catch (err) {
        setConnectionError(getErrorMessage(err));
      }
    },
    [connectToServer, resetTerminalOutput],
  );

  /** 分屏面板尺寸调整（拖动分隔条） */
  const handlePaneRatioChange = useCallback((sessionId: string, ratio: number) => {
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, paneRatio: ratio } : s)));
  }, []);

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
    const prev = appSettingsRef.current;
    if (!prev) return;
    persistAppSettings({ ...prev, themePreference: nextThemeId });
  }, [themeId, persistAppSettings]);

  const handleChangeTheme = useCallback((newThemeId: string) => {
    setThemeId(newThemeId);
    const prev = appSettingsRef.current;
    if (!prev) return;
    persistAppSettings({ ...prev, themePreference: newThemeId });
  }, [persistAppSettings]);

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
    const prev = appSettingsRef.current;
    if (!prev) return;
    const nextFontSize = delta === 0 ? 14 : Math.min(24, Math.max(12, prev.terminalFontSize + delta));
    if (nextFontSize === prev.terminalFontSize) return;
    persistAppSettings({ ...prev, terminalFontSize: nextFontSize });
  }, [persistAppSettings]);

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
  const handleOpenTool = useCallback((tool: import("./components/TabBar").ToolboxTool, serverId: string, serverName: string) => {
    setToolboxTarget({ tool, id: serverId, name: serverName });
  }, []);
  const handleOpenTransferHistory = useCallback(() => {
    setIsTransferHistoryOpen(true);
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
      if (isEventInsideContextMenu(target)) return;
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
            tabStatuses={tabStatuses}
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
            onOpenTool={handleOpenTool}
            followCwdEnabled={followCwdEnabled}
            onToggleFollowCwd={() => setFollowCwdEnabled(v => !v)}
            onReorderSessions={handleReorderSessions}
            onUpdateSessionMeta={handleUpdateSessionMeta}
            onSplitSession={handleSplitSession}
            onPaneRatioChange={handlePaneRatioChange}
            onOpenTransferHistory={handleOpenTransferHistory}
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
      <FileTransferTray isOpen={isTransferTrayOpen} server={transferTargetServer} onClose={toggleTransferTray} onOpenHistory={handleOpenTransferHistory} onCdInTerminal={handleCdInTerminal} />
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
      {toolboxTarget?.tool === 'ports' && (
        <PortMonitorModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'docker' && (
        <DockerManagerModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'services' && (
        <ServiceManagerModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'processes' && (
        <ProcessManagerModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'disk' && (
        <DiskAnalysisModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'sysinfo' && (
        <SystemInfoModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'net' && (
        <NetConnectionsModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'logstream' && (
        <LogStreamModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'cron' && (
        <ScheduledTasksModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'metrics' && (
        <MetricsHistoryModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
        />
      )}
      {toolboxTarget?.tool === 'files' && (
        <FileManagerModal
          serverId={toolboxTarget.id}
          serverName={toolboxTarget.name}
          onClose={() => setToolboxTarget(null)}
          onCdInTerminal={handleCdInTerminal}
        />
      )}
      <TransferHistoryModal
        open={isTransferHistoryOpen}
        onClose={() => setIsTransferHistoryOpen(false)}
        records={transferRecords}
        onRemove={removeTransferRecord}
        onRemoveBatch={removeTransferRecords}
        onClear={clearTransferHistory}
      />
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
