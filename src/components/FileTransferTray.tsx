import React, { useEffect, useRef, useState, useCallback } from "react";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  FaEdit,
  FaFileAlt,
  FaFolder,
  FaFolderPlus,
  FaHistory,
  FaSyncAlt,
  FaTimes,
  FaTrash,
  FaUpload,
  FaDownload,
} from "react-icons/fa";
import { Server } from "../context/ServerContext";
import styles from "./FileTransferTray.module.css";

/* ── Types ── */

interface FileTransferTrayProps {
  isOpen: boolean;
  server: Server | null;
  onClose?: () => void;
  onOpenHistory?: () => void;
}

interface FileTransferResult {
  direction: string;
  localPath: string;
  remotePath: string;
  message: string;
}

interface RemoteDirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

interface RemoteDirectoryListing {
  currentPath: string;
  parentPath?: string | null;
  entries: RemoteDirectoryEntry[];
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

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  entry: RemoteDirectoryEntry | null;
}

/* ── Helpers ── */

const joinRemotePath = (base: string, name: string) =>
  base === "/" ? `/${name}` : `${base.replace(/\/+$/, "")}/${name}`;

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = size, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
};

const getErrorMessage = (error: unknown) =>
  typeof error === "string" ? error : error instanceof Error ? error.message : "操作失败，请稍后重试。";

const normalizeRemotePath = (path: string) => {
  if (!path.trim()) return "/";
  const n = path.replace(/\/+/g, "/");
  return n.length > 1 ? n.replace(/\/$/, "") : n;
};

/* ── Component ── */

export const FileTransferTray: React.FC<FileTransferTrayProps> = ({ isOpen, server, onClose, onOpenHistory }) => {
  /* ── State ── */
  const [currentPath, setCurrentPath] = useState("/");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<RemoteDirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, entry: null });

  // Inline forms
  const [showNewDir, setShowNewDir] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [renamingEntry, setRenamingEntry] = useState<RemoteDirectoryEntry | null>(null);
  const [renameInput, setRenameInput] = useState("");

  // Resize
  const [panelWidth, setPanelWidth] = useState(420);
  const [columnWidths, setColumnWidths] = useState({ name: 200, size: 70, actions: 120 });

  // Transfer tracking
  const [transfers, setTransfers] = useState<Map<string, { name: string; status: string; percent: number }>>(new Map());

  const requestRef = useRef(0);
  const contextRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const newDirRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const canOperate = Boolean(server) && server?.osType === "linux" && (server?.hasPassword || server?.authMethod === "key");

  /* ── Resize handler ── */
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(Math.max(320, startWidth + delta), 840);
      setPanelWidth(newWidth);
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }, [panelWidth]);

  /* ── Column resize handler ── */
  const handleColumnResizeStart = useCallback((e: React.PointerEvent, column: "name" | "size" | "actions") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidths = { ...columnWidths };

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setColumnWidths(prev => {
        const newWidths = { ...prev };
        if (column === "name") {
          newWidths.name = Math.min(Math.max(100, startWidths.name + delta), panelWidth - prev.size - prev.actions - 40);
        } else if (column === "size") {
          newWidths.size = Math.min(Math.max(50, startWidths.size + delta), 150);
        } else if (column === "actions") {
          newWidths.actions = Math.min(Math.max(90, startWidths.actions + delta), 200);
        }
        return newWidths;
      });
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }, [columnWidths, panelWidth]);

  /* ── Fetch directory ── */
  const loadDirectory = async (path: string) => {
    if (!server || !canOperate) return;
    const reqId = ++requestRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const listing = await invoke<RemoteDirectoryListing>("list_remote_directory", { id: server.id, path });
      if (reqId !== requestRef.current) return;
      const norm = normalizeRemotePath(listing.currentPath);
      setCurrentPath(norm);
      setParentPath(listing.parentPath ? normalizeRemotePath(listing.parentPath) : null);
      const sorted = [...listing.entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      setSelected(null);
    } catch (err) {
      if (reqId === requestRef.current) setError(getErrorMessage(err));
    } finally {
      if (reqId === requestRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && server && canOperate) {
      // Load home directory instead of root
      loadDirectory("");
    } else {
      setEntries([]);
      setCurrentPath("/");
      setError(null);
    }
  }, [isOpen, server?.id, canOperate]);

  /* ── Progress events + editor save events ── */
  useEffect(() => {
    if (!isOpen || !server) return;
    let mounted = true;
    const unlistenProgress = listen<FileTransferProgressEvent>("file-transfer-progress", (event) => {
      if (!mounted) return;
      const p = event.payload;
      setTransfers(prev => {
        const next = new Map(prev);
        next.set(p.transferId, {
          name: p.remotePath.split("/").pop() || p.remotePath,
          status: p.status,
          percent: p.progressPercent,
        });
        if (p.status === "completed" || p.status === "failed") {
          setTimeout(() => {
            setTransfers(cur => { const n = new Map(cur); n.delete(p.transferId); return n; });
          }, 3000);
        }
        return next;
      });
    });
    const unlistenEditorSave = listen<{ serverId: string; filePath: string }>("editor-file-saved", (event) => {
      if (!mounted) return;
      if (event.payload.serverId === server.id) {
        void loadDirectory(currentPath);
      }
    });
    return () => {
      mounted = false;
      void unlistenProgress.then(fn => fn());
      void unlistenEditorSave.then(fn => fn());
    };
  }, [isOpen, server, currentPath]);

  /* ── Context menu dismiss ── */
  useEffect(() => {
    if (!contextMenu.visible) return;
    const handler = (e: MouseEvent) => {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu({ visible: false, x: 0, y: 0, entry: null });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu.visible]);

  /* ── Focus inline inputs ── */
  useEffect(() => { if (showNewDir) newDirRef.current?.focus(); }, [showNewDir]);
  useEffect(() => { if (renamingEntry) renameRef.current?.focus(); }, [renamingEntry]);

  /* ── Keyboard ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        if (contextMenu.visible) setContextMenu({ visible: false, x: 0, y: 0, entry: null });
        else if (showNewDir) setShowNewDir(false);
        else if (renamingEntry) setRenamingEntry(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, contextMenu.visible, showNewDir, renamingEntry]);

  /* ── Navigation ── */
  const navigateTo = (path: string) => loadDirectory(path);
  const goUp = () => { if (parentPath) navigateTo(parentPath); };
  const handlePathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const val = (e.target as HTMLInputElement).value.trim();
      if (val) navigateTo(val.startsWith("/") ? val : `/${val}`);
    }
  };

  /* ── File operations ── */
  const handleUploadFile = async () => {
    if (!server || !canOperate) return;
    const selected = await open({ directory: false, multiple: true, title: "选择要上传的文件" });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const localPath of paths) {
      const fileName = localPath.split(/[\\/]/).pop() || "file";
      const remotePath = joinRemotePath(currentPath, fileName);
      const transferId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await invoke<FileTransferResult>("upload_file_to_server", { id: server.id, localPath, remotePath, transferId });
      } catch { /* tracked via events */ }
    }
    loadDirectory(currentPath);
  };

  const handleUploadDirectory = async () => {
    if (!server || !canOperate) return;
    const selected = await open({ directory: true, multiple: false, title: "选择要上传的目录" });
    if (!selected || typeof selected !== "string") return;
    const dirName = selected.split(/[\\/]/).pop() || "dir";
    const remotePath = joinRemotePath(currentPath, dirName);
    const transferId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await invoke<FileTransferResult>("upload_directory_to_server", { id: server.id, localPath: selected, remotePath, transferId });
    } catch { /* tracked via events */ }
    loadDirectory(currentPath);
  };

  const handleDownload = async (entry: RemoteDirectoryEntry) => {
    if (!server || !canOperate || entry.isDir) return;
    const savePath = await save({ title: "选择保存位置", defaultPath: entry.name });
    if (typeof savePath !== "string") return;
    const transferId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await invoke<FileTransferResult>("download_file_from_server", { id: server.id, remotePath: entry.path, localPath: savePath, transferId });
    } catch { /* tracked via events */ }
  };

  const handleCreateDir = async () => {
    const name = newDirName.trim();
    if (!server || !name) return;
    try {
      await invoke("create_remote_directory", { id: server.id, path: joinRemotePath(currentPath, name) });
      setShowNewDir(false);
      setNewDirName("");
      loadDirectory(currentPath);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleRename = async () => {
    const name = renameInput.trim();
    if (!server || !renamingEntry || !name || name === renamingEntry.name) {
      setRenamingEntry(null);
      return;
    }
    try {
      await invoke("rename_remote_path", { id: server.id, path: renamingEntry.path, newPath: joinRemotePath(currentPath, name) });
      setRenamingEntry(null);
      loadDirectory(currentPath);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDelete = async (entry: RemoteDirectoryEntry) => {
    if (!server) return;
    const confirmed = await ask(`确定要删除 ${entry.path} 吗？${entry.isDir ? "目录内容将一并删除。" : ""}`, { title: "删除确认", kind: "warning" });
    if (!confirmed) return;
    try {
      await invoke("delete_remote_path", { id: server.id, path: entry.path, isDir: entry.isDir });
      if (selected === entry.path) setSelected(null);
      loadDirectory(currentPath);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleEdit = async (entry: RemoteDirectoryEntry) => {
    if (!server) return;
    const label = `editor-${server.id}-${entry.path.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const url = `/editor.html?serverId=${encodeURIComponent(server.id)}&filePath=${encodeURIComponent(entry.path)}`;

    // Check if window already exists
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }

    new WebviewWindow(label, {
      url,
      title: `编辑 - ${entry.name}`,
      width: 900,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      decorations: false,
      resizable: true,
      center: true,
    });
  };

  /* ── Context menu ── */
  const openContextMenu = (e: React.MouseEvent, entry: RemoteDirectoryEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(entry.path);
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, entry });
  };

  /* ── Row interaction ── */
  const handleRowClick = (entry: RemoteDirectoryEntry) => {
    setSelected(entry.path);
    if (entry.isDir) navigateTo(entry.path);
  };

  const handleRowDoubleClick = (entry: RemoteDirectoryEntry) => {
    if (!entry.isDir) void handleEdit(entry);
  };

  const totalSize = entries.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0);
  const activeTransfers = Array.from(transfers.values()).filter(t => t.status === "progress" || t.status === "preparing");

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      data-closed={!isOpen}
      data-slot="file-transfer"
      style={{ width: isOpen ? panelWidth : 0 }}
    >
      {/* Resize handle */}
      {isOpen && (
        <div
          className={styles.resizeHandle}
          onPointerDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整文件面板宽度"
        />
      )}

      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>文件传输</span>
        {onClose && (
          <button className={styles.headerClose} onClick={onClose} title="关闭">
            <FaTimes size={12} />
          </button>
        )}
      </div>

      {/* ── Path bar ── */}
      <div className={styles.pathBar}>
        <button className={styles.pathButton} onClick={goUp} disabled={!parentPath} title="返回上级">
          ←
        </button>
        <input
          ref={pathInputRef}
          className={styles.pathInput}
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={handlePathKeyDown}
          placeholder="输入路径并回车跳转"
        />
      </div>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <button className={styles.toolButton} onClick={handleUploadFile} disabled={!canOperate} title="上传文件">
          <FaUpload size={12} /> <span>上传文件</span>
        </button>
        <button className={styles.toolButton} onClick={handleUploadDirectory} disabled={!canOperate} title="上传目录">
          <FaFolderPlus size={12} /> <span>上传目录</span>
        </button>
        <button className={styles.toolButton} onClick={() => setShowNewDir(true)} disabled={!canOperate} title="新建文件夹">
          <FaFolderPlus size={12} />
        </button>
        <div className={styles.toolSpacer} />
        {onOpenHistory && (
          <button className={styles.toolButton} onClick={onOpenHistory} title="传输历史">
            <FaHistory size={12} />
          </button>
        )}
        <button className={styles.toolButton} onClick={() => loadDirectory(currentPath)} disabled={isLoading || !canOperate} title="刷新">
          <FaSyncAlt size={12} />
        </button>
      </div>

      {/* ── New directory form ── */}
      {showNewDir && (
        <div className={styles.inlineForm}>
          <input
            ref={newDirRef}
            className={styles.inlineInput}
            placeholder="文件夹名称"
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateDir();
              if (e.key === "Escape") setShowNewDir(false);
            }}
          />
          <button className={styles.inlineButton} onClick={handleCreateDir}>创建</button>
          <button className={styles.inlineCancelButton} onClick={() => setShowNewDir(false)}>取消</button>
        </div>
      )}

      {/* ── Active transfers ── */}
      {activeTransfers.length > 0 && (
        <div className={styles.transferBar}>
          {activeTransfers.map((t, i) => (
            <div key={i} className={styles.transferItem}>
              <FaDownload size={10} />
              <span className={styles.transferName}>{t.name}</span>
              <span>{t.percent}%</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className={styles.errorBanner}>
          <span className={styles.errorMessage}>{error}</span>
          <button className={styles.errorDismiss} onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* ── File table ── */}
      <div className={styles.fileTable}>
        <div className={styles.tableHeader}>
          <span style={{ width: columnWidths.name }} className={styles.colName}>
            名称
            <div
              className={styles.colResizeHandle}
              onPointerDown={(e) => handleColumnResizeStart(e, "name")}
            />
          </span>
          <span style={{ width: columnWidths.size }} className={styles.colSize}>
            大小
            <div
              className={styles.colResizeHandle}
              onPointerDown={(e) => handleColumnResizeStart(e, "size")}
            />
          </span>
          <span style={{ width: columnWidths.actions }} className={styles.colActions}>
            操作
          </span>
        </div>
        <div className={styles.tableBody}>
          {!canOperate ? (
            <div className={styles.emptyState}>
              {!server ? "请先选择一台服务器" : server.osType !== "linux" ? "仅支持 Linux 服务器" : "请先保存 SSH 密码或密钥"}
            </div>
          ) : isLoading && entries.length === 0 ? (
            <div className={styles.emptyState}>正在加载...</div>
          ) : entries.length === 0 ? (
            <div className={styles.emptyState}>此目录为空</div>
          ) : (
            entries.map((entry) => {
              const isRenaming = renamingEntry?.path === entry.path;
              return (
                <div
                  key={entry.path}
                  className={styles.fileRow}
                  data-selected={selected === entry.path}
                  data-type={entry.isDir ? "dir" : "file"}
                  onClick={() => handleRowClick(entry)}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
                  onContextMenu={(e) => openContextMenu(e, entry)}
                >
                  <div className={styles.fileName} style={{ width: columnWidths.name }}>
                    {entry.isDir ? (
                      <FaFolder className={styles.fileIcon} data-type="dir" />
                    ) : (
                      <FaFileAlt className={styles.fileIcon} data-type="file" />
                    )}
                    {isRenaming ? (
                      <input
                        ref={renameRef}
                        className={styles.inlineInput}
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename();
                          if (e.key === "Escape") setRenamingEntry(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ padding: "2px 6px", fontSize: 12 }}
                      />
                    ) : (
                      <span className={styles.fileNametext} title={entry.name}>{entry.name}</span>
                    )}
                  </div>
                  <span className={styles.fileSize} style={{ width: columnWidths.size }}>
                    {entry.isDir ? "—" : formatFileSize(entry.size)}
                  </span>
                  <div className={styles.fileActions} style={{ width: columnWidths.actions }}>
                    {!entry.isDir && (
                      <button
                        className={styles.fileActionBtn}
                        data-action="edit"
                        title="编辑"
                        onClick={(e) => { e.stopPropagation(); void handleEdit(entry); }}
                      >
                        <FaEdit size={12} />
                      </button>
                    )}
                    {!entry.isDir && (
                      <button
                        className={styles.fileActionBtn}
                        data-action="download"
                        title="下载"
                        onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                      >
                        <FaDownload size={12} />
                      </button>
                    )}
                    <button
                      className={styles.fileActionBtn}
                      data-action="delete"
                      title="删除"
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                    >
                      <FaTrash size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span>{entries.length} 项</span>
          <span>{formatFileSize(totalSize)}</span>
        </div>
        <div className={styles.statusRight}>
          <span className={styles.statusServer}>{server?.name || "未选择服务器"}</span>
        </div>
      </div>

      {/* ── Context menu ── */}
      {contextMenu.visible && contextMenu.entry && (
        <div
          ref={contextRef}
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry.isDir && (
            <button
              className={styles.contextItem}
              onClick={() => { navigateTo(contextMenu.entry!.path); setContextMenu({ visible: false, x: 0, y: 0, entry: null }); }}
            >
              打开
            </button>
          )}
          {!contextMenu.entry.isDir && (
            <>
              <button
                className={styles.contextItem}
                onClick={() => { void handleEdit(contextMenu.entry!); setContextMenu({ visible: false, x: 0, y: 0, entry: null }); }}
              >
                <FaEdit size={11} /> 编辑
              </button>
              <button
                className={styles.contextItem}
                onClick={() => { handleDownload(contextMenu.entry!); setContextMenu({ visible: false, x: 0, y: 0, entry: null }); }}
              >
                <FaDownload size={11} /> 下载
              </button>
            </>
          )}
          <div className={styles.contextDivider} />
          <button
            className={styles.contextItem}
            onClick={() => {
              setRenamingEntry(contextMenu.entry);
              setRenameInput(contextMenu.entry!.name);
              setContextMenu({ visible: false, x: 0, y: 0, entry: null });
            }}
          >
            重命名
          </button>
          <div className={styles.contextDivider} />
          <button
            className={styles.contextItem}
            data-danger="true"
            onClick={() => { handleDelete(contextMenu.entry!); setContextMenu({ visible: false, x: 0, y: 0, entry: null }); }}
          >
            <FaTrash size={11} /> 删除
          </button>
        </div>
      )}
    </div>
  );
};
