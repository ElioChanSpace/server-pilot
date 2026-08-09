import React, { useState, useRef, useEffect, useCallback, lazy, memo, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { ServerProvider, Server, Category, useServer } from "./context/ServerContext";
import { AddServerModal } from "./components/AddServerModal";
import { AddCategoryModal } from "./components/AddCategoryModal";
import { ImportSshConfigModal } from "./components/ImportSshConfigModal";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { BottomBar } from "./components/BottomBar";
import { FileTransferTray } from "./components/FileTransferTray";
import { MainContent } from "./components/MainContent";
import { ContextMenu, ContextMenuAction } from "./components/ContextMenu";
import modalStyles from "./components/Modal.module.css";
import { FaEdit, FaPlus, FaFolderPlus, FaMoon, FaPlug, FaSun, FaUnlink } from 'react-icons/fa';
import type {
  TerminalSession,
  TerminalSessionClosedEvent,
  TerminalSessionStatus,
  TerminalSessionStatusEvent,
} from "./types/terminal";
import "./App.css";

const LogViewer = lazy(() => import("./components/LogViewer"));

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

const MenuBar: React.FC<{
  onNewCategory: () => void;
  onNewServer: () => void;
  onImportSshConfig: () => void;
  onViewLogs: () => void;
  onOpenSettings: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}> = ({ onNewCategory, onNewServer, onImportSshConfig, onViewLogs, onOpenSettings, theme, onToggleTheme }) => {
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

  const handleMenuBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!openMenu) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Keep existing button/dropdown interactions intact; only close when clicking
    // the menu bar background or spacer area around the top-level menus.
    if (target.closest('.menuItem') || target.closest('.themeToggle')) {
      return;
    }

    setOpenMenu(null);
  };

  return (
    <div className="menuBar" ref={menuRef} onPointerDown={handleMenuBarPointerDown}>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')} data-active={openMenu === 'file'}>文件</button>
        {openMenu === 'file' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onNewCategory)}>新建分类...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onNewServer)}>新建服务器...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onImportSshConfig)}>从 SSH Config 导入...</button>
            <div className="separator" />
            <button className="dropdownItem" onClick={() => window.close()}>退出</button>
          </div>
        )}
      </div>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'system' ? null : 'system')} data-active={openMenu === 'system'}>系统</button>
        {openMenu === 'system' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onOpenSettings)}>设置</button>
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

const MemoizedMenuBar = memo(MenuBar);

interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

interface TerminalOutputState {
  chunks: string[];
  resetToken: number;
}

interface FileTransferProgressEvent {
  transferId: string;
  direction: string;
  localPath: string;
  remotePath: string;
  status: "preparing" | "progress" | "completed" | "failed";
  progressPercent: number;
  transferredBytes?: number | null;
  totalBytes?: number | null;
  bytesPerSecond?: number | null;
  etaSeconds?: number | null;
  message?: string | null;
}

interface UploadProgressOverlayState {
  transferId: string;
  sessionId: string;
  serverName: string;
  currentDirectory: string;
  currentFileName: string;
  currentFileIndex: number;
  totalFiles: number;
  status: "preparing" | "uploading" | "completed" | "failed";
  progressPercent: number;
  transferredBytes: number | null;
  totalBytes: number | null;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  message: string | null;
}

interface HostKeyPromptEvent {
  sessionId: string;
  serverId: string;
  fingerprint: string;
}

interface SessionRemovalOptions {
  preferredNextSessionId?: string | null;
  anchorSessionId?: string | null;
}

const reindexSessions = (sessionList: TerminalSession[]) => {
  const serverSessionCounts = new Map<string, number>();

  return sessionList.map(session => {
    const nextIndex = (serverSessionCounts.get(session.serverId) ?? 0) + 1;
    serverSessionCounts.set(session.serverId, nextIndex);

    if (session.terminalIndex === nextIndex) {
      return session;
    }

    return {
      ...session,
      terminalIndex: nextIndex,
    };
  });
};

const resolveNextSessionId = (
  previousSessions: TerminalSession[],
  remainingSessions: TerminalSession[],
  currentSessionId: string | null,
  { preferredNextSessionId = null, anchorSessionId = null }: SessionRemovalOptions = {},
) => {
  if (preferredNextSessionId && remainingSessions.some(session => session.id === preferredNextSessionId)) {
    return preferredNextSessionId;
  }

  if (currentSessionId && remainingSessions.some(session => session.id === currentSessionId)) {
    return currentSessionId;
  }

  const anchorId = anchorSessionId ?? currentSessionId;
  const remainingIds = new Set(remainingSessions.map(session => session.id));

  if (anchorId) {
    const anchorIndex = previousSessions.findIndex(session => session.id === anchorId);

    if (anchorIndex >= 0) {
      for (let index = anchorIndex; index < previousSessions.length; index += 1) {
        const candidateId = previousSessions[index]?.id;
        if (candidateId && remainingIds.has(candidateId)) {
          return candidateId;
        }
      }

      for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const candidateId = previousSessions[index]?.id;
        if (candidateId && remainingIds.has(candidateId)) {
          return candidateId;
        }
      }
    }
  }

  return remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null;
};

const getBaseName = (filePath: string) => {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
};

const joinRemotePath = (basePath: string, name: string) => {
  if (basePath === "/") {
    return `/${name}`;
  }

  return `${basePath.replace(/\/+$/, "")}/${name}`;
};

const createTransferId = () => `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const formatBytes = (value: number | null) => {
  if (!value || value <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
};

const formatTransferRate = (bytesPerSecond: number | null) => {
  const formatted = formatBytes(bytesPerSecond);
  return formatted ? `${formatted}/s` : null;
};

const formatEta = (etaSeconds: number | null) => {
  if (etaSeconds === null || etaSeconds < 0) {
    return null;
  }

  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "上传失败，请稍后重试。";
};

const isTextInputElement = (
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

const isEditableElement = (element: Element | null) =>
  isTextInputElement(element) || (element instanceof HTMLElement && element.isContentEditable);

const isInsideTerminal = (element: Element | null) =>
  element instanceof Element && Boolean(element.closest(".xterm, .xterm-host"));

const getCopyTextFromTarget = (target: Element | null) => {
  if (isTextInputElement(target)) {
    const { selectionStart, selectionEnd, value } = target;
    if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) {
      return value.slice(selectionStart, selectionEnd);
    }
  }

  return window.getSelection()?.toString() ?? "";
};

const insertTextIntoEditable = (target: Element | null, text: string) => {
  if (!text) {
    return false;
  }

  if (isTextInputElement(target)) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    target.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
};

const AppContent: React.FC = () => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isResizingRightSidebar, setIsResizingRightSidebar] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [isUncategorizedSelected, setIsUncategorizedSelected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"dashboard" | "settings" | "logs">("dashboard");
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSshImportOpen, setIsSshImportOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [initialCategoryId, setInitialCategoryId] = useState<string | undefined>(undefined);
  const [initialParentId, setInitialParentId] = useState<string | undefined>(undefined);
  const [editingServer, setEditingServer] = useState<Server | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<TerminalSession[]>([]);
  const serversRef = useRef<Server[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, TerminalOutputState>>({});
  const pendingTerminalChunksRef = useRef<Record<string, string[]>>({});
  const terminalFlushFrameRef = useRef<number | null>(null);
  const [isTransferTrayOpen, setIsTransferTrayOpen] = useState(false);
  const [, setSessionCurrentDirectories] = useState<Record<string, string>>({});
  const [uploadProgressOverlay, setUploadProgressOverlay] = useState<UploadProgressOverlayState | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptEvent | null>(null);
  
  const { connectToServer, disconnectServer, closeTerminalSession, servers } = useServer();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY));
    const width = Number.isFinite(storedWidth) ? clampRightSidebarWidth(storedWidth) : 420;
    document.documentElement.style.setProperty("--right-sidebar-width", `${width}px`);
  }, []);

  useEffect(() => {
    return () => {
      if (terminalFlushFrameRef.current !== null) {
        cancelAnimationFrame(terminalFlushFrameRef.current);
        terminalFlushFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isResizingRightSidebar) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = clampRightSidebarWidth(window.innerWidth - event.clientX);
      document.documentElement.style.setProperty("--right-sidebar-width", `${nextWidth}px`);
    };

    const handlePointerUp = () => {
      setIsResizingRightSidebar(false);
      const currentWidth = Number.parseFloat(
        document.documentElement.style.getPropertyValue("--right-sidebar-width"),
      );
      if (Number.isFinite(currentWidth)) {
        window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(currentWidth));
      }
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

  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    const handleGlobalClipboardShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (isInsideTerminal(target)) {
        return;
      }

      const hasPrimaryModifier = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!hasPrimaryModifier || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "c") {
        const text = getCopyTextFromTarget(target);
        if (!text) {
          return;
        }

        event.preventDefault();
        void navigator.clipboard.writeText(text).catch(error => {
          console.error("快捷键复制失败:", error);
        });
        return;
      }

      if (key === "v" && isEditableElement(target)) {
        event.preventDefault();
        void navigator.clipboard.readText()
          .then(text => {
            insertTextIntoEditable(target, text);
          })
          .catch(error => {
            console.error("快捷键粘贴失败:", error);
          });
      }
    };

    window.addEventListener("keydown", handleGlobalClipboardShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalClipboardShortcut, true);
    };
  }, []);

  const flushPendingTerminalChunks = useCallback(() => {
    terminalFlushFrameRef.current = null;
    const pendingChunks = pendingTerminalChunksRef.current;
    pendingTerminalChunksRef.current = {};
    const entries = Object.entries(pendingChunks);
    if (entries.length === 0) {
      return;
    }

    setTerminalOutputs(prev => {
      const next = { ...prev };
      for (const [sessionId, chunks] of entries) {
        const existing = next[sessionId];
        next[sessionId] = {
          chunks: [...(existing?.chunks ?? []), ...chunks],
          resetToken: existing?.resetToken ?? 0,
        };
      }
      return next;
    });
  }, []);

  const appendTerminalChunk = useCallback((sessionId: string, chunk: string) => {
    if (!sessionsRef.current.some(session => session.id === sessionId)) {
      return;
    }

    const pending = pendingTerminalChunksRef.current;
    (pending[sessionId] ??= []).push(chunk);

    if (terminalFlushFrameRef.current !== null) {
      return;
    }

    terminalFlushFrameRef.current = requestAnimationFrame(flushPendingTerminalChunks);
  }, [flushPendingTerminalChunks]);

  const resetTerminalOutput = useCallback((sessionId: string, initialChunks: string[] = []) => {
    setTerminalOutputs(prev => ({
      ...prev,
      [sessionId]: {
        chunks: initialChunks,
        resetToken: (prev[sessionId]?.resetToken ?? 0) + 1,
      },
    }));
  }, []);

  const removeTerminalOutputs = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }

    const removedIds = new Set(sessionIds);
    setTerminalOutputs(prev => {
      const next = { ...prev };
      removedIds.forEach(sessionId => {
        delete next[sessionId];
      });
      return next;
    });
  }, []);

  const removeSessionCurrentDirectories = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }

    const removedIds = new Set(sessionIds);
    setSessionCurrentDirectories(prev => {
      const next = { ...prev };
      removedIds.forEach(sessionId => {
        delete next[sessionId];
      });
      return next;
    });
  }, []);

  const updateSessionStatus = useCallback((sessionId: string, status: TerminalSessionStatus) => {
    setSessions(prev => prev.map(session => (
      session.id === sessionId
        ? { ...session, status }
        : session
    )));
  }, []);

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
      listen<TerminalSessionStatusEvent>("terminal-session-status-changed", (event) => {
        updateSessionStatus(event.payload.sessionId, event.payload.status);
      }),
      listen<TerminalSessionClosedEvent>("terminal-session-closed", (event) => {
        setHostKeyPrompt(prev => (prev && prev.sessionId === event.payload.sessionId ? null : prev));
        if (event.payload.shouldRemove) {
          applySessionRemoval([event.payload.sessionId], { anchorSessionId: event.payload.sessionId });
          return;
        }

        updateSessionStatus(event.payload.sessionId, "disconnected");
      }),
      listen<FileTransferProgressEvent>("file-transfer-progress", (event) => {
        const payload = event.payload;
        setUploadProgressOverlay(prev => {
          if (!prev || prev.transferId !== payload.transferId) {
            return prev;
          }

          return {
            ...prev,
            status:
              payload.status === "progress"
                ? "uploading"
                : payload.status,
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
  }, []);

  useEffect(() => {
    if (!uploadProgressOverlay || (uploadProgressOverlay.status !== "completed" && uploadProgressOverlay.status !== "failed")) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setUploadProgressOverlay(current => {
        if (!current || current.transferId !== uploadProgressOverlay.transferId) {
          return current;
        }
        return null;
      });
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [uploadProgressOverlay]);

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

    setActiveView("dashboard");

    try {
      const result = await connectToServer(server.id);
      setSessions(prev => reindexSessions([
        ...prev,
        {
          id: result.sessionId,
          serverId: server.id,
          terminalIndex: 0,
          status: "connecting",
        },
      ]));
      setCurrentSessionId(result.sessionId);
      resetTerminalOutput(result.sessionId, [`[信息] 正在连接 ${server.username}@${server.host}:${server.port} ...\r\n`]);
    } catch (err) {
      const message = err as string;
      setConnectionError(message);
    }
  }, [clearSelection, connectToServer, resetTerminalOutput]);

  const applySessionRemoval = useCallback((sessionIds: string[], options: SessionRemovalOptions = {}) => {
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
  }, [clearSelection, removeTerminalOutputs, removeSessionCurrentDirectories]);

  const handleCloseSession = useCallback((sessionId: string) => {
    closeTerminalSession(sessionId).catch(err => console.error("关闭终端失败:", err));
    applySessionRemoval([sessionId], { anchorSessionId: sessionId });
  }, [applySessionRemoval, closeTerminalSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
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
  }, [clearSelection, servers, sessions]);

  const handleDuplicateSession = useCallback((sessionId: string) => {
    const session = sessions.find(item => item.id === sessionId);
    if (!session) {
      return;
    }

    const server = servers.find(item => item.id === session.serverId);
    if (!server) {
      return;
    }

    void handleConnectServer(server);
  }, [handleConnectServer, servers, sessions]);

  const handleCloseSessionsToLeft = useCallback((sessionId: string) => {
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    if (sessionIndex <= 0) {
      return;
    }

    const targetSessionIds = sessions.slice(0, sessionIndex).map(session => session.id);
    targetSessionIds.forEach(id => {
      closeTerminalSession(id).catch(err => console.error("关闭左侧终端失败:", err));
    });
    applySessionRemoval(targetSessionIds, { preferredNextSessionId: sessionId, anchorSessionId: sessionId });
  }, [applySessionRemoval, closeTerminalSession, sessions]);

  const handleCloseSessionsToRight = useCallback((sessionId: string) => {
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    if (sessionIndex < 0 || sessionIndex >= sessions.length - 1) {
      return;
    }

    const targetSessionIds = sessions.slice(sessionIndex + 1).map(session => session.id);
    targetSessionIds.forEach(id => {
      closeTerminalSession(id).catch(err => console.error("关闭右侧终端失败:", err));
    });
    applySessionRemoval(targetSessionIds, { preferredNextSessionId: sessionId, anchorSessionId: sessionId });
  }, [applySessionRemoval, closeTerminalSession, sessions]);

  const handleCloseServerSessions = useCallback((sessionId: string) => {
    const targetSession = sessions.find(session => session.id === sessionId);
    if (!targetSession) {
      return;
    }

    const targetSessionIds = sessions
      .filter(session => session.serverId === targetSession.serverId)
      .map(session => session.id);

    if (targetSessionIds.length === 0) {
      return;
    }

    disconnectServer(targetSession.serverId).catch(err => console.error("关闭当前服务器所有终端失败:", err));
    applySessionRemoval(targetSessionIds, { anchorSessionId: sessionId });
  }, [applySessionRemoval, disconnectServer, sessions]);

  const handleCloseAllSessions = useCallback(() => {
    if (sessions.length === 0) {
      return;
    }

    const targetSessionIds = sessions.map(session => session.id);
    const relatedServerIds = Array.from(new Set(sessions.map(session => session.serverId)));

    relatedServerIds.forEach(serverId => {
      disconnectServer(serverId).catch(err => console.error("关闭所有终端失败:", err));
    });

    applySessionRemoval(targetSessionIds, { anchorSessionId: currentSessionId });
  }, [applySessionRemoval, currentSessionId, disconnectServer, sessions]);

  const handleTerminalFilesDropped = useCallback(async (sessionId: string, paths: string[]) => {
    const targetSession = sessions.find(session => session.id === sessionId);
    if (!targetSession) {
      return;
    }

    const targetServer = servers.find(server => server.id === targetSession.serverId);
    if (!targetServer) {
      return;
    }

    let currentDirectory: string;
    try {
      currentDirectory = await invoke<string>("get_terminal_session_directory", { sessionId });
      setSessionCurrentDirectories(prev => ({
        ...prev,
        [sessionId]: currentDirectory,
      }));
    } catch (error) {
      await message(getErrorMessage(error), "无法读取当前终端目录");
      return;
    }

    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) {
      return;
    }

    const previewNames = uniquePaths.slice(0, 3).map(path => getBaseName(path)).join("、");
    const confirmed = await confirm(
      `${uniquePaths.length > 1 ? `检测到 ${uniquePaths.length} 个文件` : `检测到文件 ${previewNames}`}，是否上传到当前目录 ${currentDirectory}？`,
      "上传到当前终端目录",
    );

    if (!confirmed) {
      return;
    }

    for (let index = 0; index < uniquePaths.length; index += 1) {
      const localPath = uniquePaths[index];
      const currentFileName = getBaseName(localPath);
      const remotePath = joinRemotePath(currentDirectory, currentFileName);
      const transferId = createTransferId();

      setUploadProgressOverlay({
        transferId,
        sessionId,
        serverName: targetServer.name,
        currentDirectory,
        currentFileName,
        currentFileIndex: index + 1,
        totalFiles: uniquePaths.length,
        status: "preparing",
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: null,
        bytesPerSecond: null,
        etaSeconds: null,
        message: "准备上传文件",
      });

      try {
        await invoke("upload_file_to_server", {
          id: targetServer.id,
          localPath,
          remotePath,
          transferId,
        });
      } catch (error) {
        setUploadProgressOverlay(current => {
          if (!current || current.transferId !== transferId) {
            return current;
          }

          return {
            ...current,
            status: "failed",
            progressPercent: current.progressPercent,
            bytesPerSecond: null,
            etaSeconds: null,
            message: getErrorMessage(error),
          };
        });
        return;
      }
    }
  }, [servers, sessions]);

  const handleSelectCategory = useCallback((category: Category | null) => {
    clearSelection();
    setActiveCategory(category);
    setIsUncategorizedSelected(category === null);
    setActiveView("dashboard");
  }, [clearSelection]);

  const handleDisconnectServer = useCallback(async (server: Server) => {
    const relatedSessions = sessions.filter(session => session.serverId === server.id);
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
  }, [applySessionRemoval, currentSessionId, disconnectServer, sessions]);

  const handleEditServerSaved = useCallback((updatedServer: Server) => {
    setActiveServer(prev => (prev?.id === updatedServer.id ? updatedServer : prev));
    setEditingServer(undefined);
  }, []);

  const handleCategoryContextMenu = useCallback((event: React.MouseEvent, category: Category | null) => {
    const actions: ContextMenuAction[] = [
      { label: "新建服务器", icon: <FaPlus />, action: () => { setEditingServer(undefined); setInitialCategoryId(category?.id); setIsServerModalOpen(true); }},
      { label: "新建子分类", icon: <FaFolderPlus />, action: () => { setInitialParentId(category?.id); setIsCategoryModalOpen(true); }}
    ];
    setContextMenu({ x: event.clientX, y: event.clientY, actions });
  }, []);

  // --- 新增：处理服务器右键菜单 ---
  const handleServerContextMenu = useCallback((event: React.MouseEvent, server: Server) => {
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
  }, [handleConnectServer, handleDisconnectServer]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const handleNewCategory = useCallback(() => {
    setInitialParentId(undefined);
    setIsCategoryModalOpen(true);
  }, []);
  const handleNewServer = useCallback(() => {
    setEditingServer(undefined);
    setInitialCategoryId(undefined);
    setIsServerModalOpen(true);
  }, []);
  const handleOpenSshImport = useCallback(() => setIsSshImportOpen(true), []);
  const handleOpenSettings = useCallback(() => {
    setIsLogViewerOpen(false);
    clearSelection();
    setCurrentSessionId(null);
    setActiveView("settings");
  }, [clearSelection]);
  const handleOpenLogViewer = useCallback(() => setIsLogViewerOpen(true), []);
  const handleCreateServerInCategory = useCallback((category: Category | null) => {
    setEditingServer(undefined);
    setInitialCategoryId(category?.id);
    setIsServerModalOpen(true);
  }, []);
  const handleCreateSubCategory = useCallback((category: Category | null) => {
    setInitialParentId(category?.id);
    setIsCategoryModalOpen(true);
  }, []);
  const handleToggleTheme = useCallback(() => {
    setTheme(prev => (prev === "dark" ? "light" : "dark"));
  }, []);
  const handleDismissError = useCallback(() => setConnectionError(null), []);
  const handleCloseLogViewer = useCallback(() => setIsLogViewerOpen(false), []);
  const respondHostKey = useCallback((accept: boolean) => {
    if (!hostKeyPrompt) {
      return;
    }

    const sessionId = hostKeyPrompt.sessionId;
    setHostKeyPrompt(null);
    void invoke("respond_to_host_key_prompt", { sessionId, accept }).catch(error => {
      console.error("回应主机指纹失败:", error);
    });
  }, [hostKeyPrompt]);
  const toggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarOpen(prev => !prev);
  }, []);
  const toggleRightSidebar = useCallback(() => {
    setIsRightSidebarOpen(prev => !prev);
  }, []);
  const toggleTransferTray = useCallback(() => {
    setIsTransferTrayOpen(prev => !prev);
  }, []);

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
      <MemoizedMenuBar 
        onNewCategory={handleNewCategory}
        onNewServer={handleNewServer}
        onImportSshConfig={handleOpenSshImport}
        onOpenSettings={handleOpenSettings}
        onViewLogs={handleOpenLogViewer}
        theme={theme}
        onToggleTheme={handleToggleTheme}
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
          onCreateServer={handleCreateServerInCategory}
          onCreateSubCategory={handleCreateSubCategory}
          onConnectServer={handleConnectServer}
          onDisconnectServer={handleDisconnectServer}
          onServerContextMenu={handleServerContextMenu}
        />
        <div className="workspace-shell">
          <MainContent 
            activeView={activeView} 
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
                activeServer={activeServer}
                activeCategory={activeCategory}
                isUncategorizedSelected={isUncategorizedSelected}
                connectionError={connectionError}
                onConnectServer={handleConnectServer}
                onDisconnectServer={handleDisconnectServer}
                onDismissError={handleDismissError}
              />
            </div>
          )}
          {isLogViewerOpen && (
            <div className="log-viewer-overlay">
              <Suspense fallback={<div className="lazy-fallback">正在加载日志...</div>}>
                <LogViewer onClose={handleCloseLogViewer} />
              </Suspense>
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
        toggleLeftSidebar={toggleLeftSidebar}
        toggleRightSidebar={toggleRightSidebar}
        toggleTransferTray={toggleTransferTray}
      />
      {uploadProgressOverlay && (
        <div className="upload-progress-toast" data-status={uploadProgressOverlay.status}>
          <div className="upload-progress-toast__header">
            <strong>
              上传文件
              {uploadProgressOverlay.totalFiles > 1
                ? ` ${uploadProgressOverlay.currentFileIndex}/${uploadProgressOverlay.totalFiles}`
                : ""}
            </strong>
            <span>{uploadProgressOverlay.serverName}</span>
          </div>
          <div className="upload-progress-toast__name">{uploadProgressOverlay.currentFileName}</div>
          <div className="upload-progress-toast__path">{uploadProgressOverlay.currentDirectory}</div>
          <div className="upload-progress-toast__bar">
            <div
              className="upload-progress-toast__bar-fill"
              style={{ width: `${Math.max(0, Math.min(100, uploadProgressOverlay.progressPercent))}%` }}
            />
          </div>
          <div className="upload-progress-toast__meta">
            <span>{uploadProgressOverlay.progressPercent}%</span>
            <span>{formatTransferRate(uploadProgressOverlay.bytesPerSecond) ?? "--"}</span>
            <span>{formatEta(uploadProgressOverlay.etaSeconds) ?? "--:--"}</span>
          </div>
          <div className="upload-progress-toast__footer">
            <span>
              {formatBytes(uploadProgressOverlay.transferredBytes) ?? "0 B"}
              {" / "}
              {formatBytes(uploadProgressOverlay.totalBytes) ?? "--"}
            </span>
            <span>{uploadProgressOverlay.message ?? ""}</span>
          </div>
        </div>
      )}
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
      {isSshImportOpen && <ImportSshConfigModal onClose={() => setIsSshImportOpen(false)} />}
      {isCategoryModalOpen && <AddCategoryModal onClose={() => setIsCategoryModalOpen(false)} parentId={initialParentId} />}
      {hostKeyPrompt && (
        <div className={modalStyles.overlay}>
          <div className={modalStyles.content}>
            <h2 className={modalStyles.title}>主机指纹确认</h2>
            <p className={modalStyles.helpText}>
              首次连接{" "}
              <strong>
                {serversRef.current.find(server => server.id === hostKeyPrompt.serverId)?.name ?? "服务器"}
              </strong>
              ，请核对远程主机指纹：
            </p>
            <pre className={modalStyles.fingerprint}>{hostKeyPrompt.fingerprint}</pre>
            <p className={modalStyles.helpText}>
              确认后将写入 known_hosts。若指纹与预期不符，请选择"取消"。
            </p>
            <div className={modalStyles.actions}>
              <button type="button" className={modalStyles.secondaryButton} onClick={() => respondHostKey(false)}>
                取消
              </button>
              <button type="button" onClick={() => respondHostKey(true)}>
                信任并连接
              </button>
            </div>
          </div>
        </div>
      )}
      {contextMenu && <ContextMenu {...contextMenu} menuRef={contextMenuRef} onClose={closeContextMenu} />}
    </div>
  );
}

function App() {
  return (
    <ServerProvider>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </ServerProvider>
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("应用渲染失败:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>应用遇到错误</h2>
          <p>{this.state.error.message || String(this.state.error)}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default App;
