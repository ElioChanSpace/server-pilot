import React, { useEffect, useRef, useState } from "react";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  FaDownload,
  FaFileAlt,
  FaFolder,
  FaFolderPlus,
  FaRedo,
  FaTrash,
  FaUpload,
} from "react-icons/fa";
import { Server } from "../context/ServerContext";
import styles from "./FileTransferTray.module.css";

interface FileTransferTrayProps {
  isOpen: boolean;
  server: Server | null;
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

interface NormalizedRemoteDirectoryListing {
  currentPath: string;
  parentPath: string | null;
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

interface TransferRecord {
  transferId: string;
  fileName: string;
  direction: "upload" | "download";
  status: "preparing" | "progress" | "completed" | "failed";
  progressPercent: number;
  message: string;
}

const getBaseName = (filePath: string) => {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "file";
};

const joinRemotePath = (basePath: string, name: string) => {
  if (basePath === "/") {
    return `/${name}`;
  }

  return `${basePath.replace(/\/+$/, "")}/${name}`;
};

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }

  const units = ["字节", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "文件传输失败，请稍后重试。";
};

const buildBreadcrumbs = (path: string) => {
  if (path === "/") {
    return [{ label: "/", path: "/" }];
  }

  const segments = path.split("/").filter(Boolean);
  return [
    { label: "/", path: "/" },
    ...segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join("/")}`,
    })),
  ];
};

const normalizeRemotePath = (path: string) => {
  if (!path.trim()) {
    return "/";
  }

  const normalized = path.replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
};

const normalizeDirectoryListing = (listing: RemoteDirectoryListing): NormalizedRemoteDirectoryListing => ({
  currentPath: normalizeRemotePath(listing.currentPath),
  parentPath: listing.parentPath ? normalizeRemotePath(listing.parentPath) : null,
  entries: listing.entries.map(entry => ({
    ...entry,
    path: normalizeRemotePath(entry.path),
  })),
});

const createTransferId = () =>
  `tray-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const FileTransferTray: React.FC<FileTransferTrayProps> = ({ isOpen, server }) => {
  const [uploadRemotePath, setUploadRemotePath] = useState("");
  const [downloadRemotePath, setDownloadRemotePath] = useState("");
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<"upload" | "download" | null>(null);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [remoteBrowserPath, setRemoteBrowserPath] = useState("");
  const [remoteBrowserParentPath, setRemoteBrowserParentPath] = useState<string | null>(null);
  const [remoteEntries, setRemoteEntries] = useState<RemoteDirectoryEntry[]>([]);
  const [remoteBrowserError, setRemoteBrowserError] = useState<string | null>(null);
  const [isLoadingRemoteEntries, setIsLoadingRemoteEntries] = useState(false);
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [renamingEntry, setRenamingEntry] = useState<RemoteDirectoryEntry | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const activeDirectoryRequestRef = useRef(0);

  const isLinux = server?.osType === "linux";
  const hasSavedPassword = Boolean(server?.hasPassword);
  const usesKeyAuth = server?.authMethod === "key";
  const canTransferFiles = Boolean(server) && isLinux && (hasSavedPassword || usesKeyAuth);
  const transferHint = !server
    ? "先在左侧或会话区域选中一台服务器，再使用底部文件传输模块。"
    : !isLinux
      ? "当前仅支持 Linux 服务器传输文件。"
      : !hasSavedPassword && !usesKeyAuth
        ? "请先为当前服务器保存 SSH 密码或密钥，再执行上传或下载。"
        : "支持本地与服务器之间的多文件上传、下载，并可按目录层级浏览远程文件。";

  const updateTransfer = (transferId: string, patch: Partial<TransferRecord>) => {
    setTransfers(prev => prev.map(record => (
      record.transferId === transferId ? { ...record, ...patch } : record
    )));
  };

  const loadRemoteDirectory = React.useCallback(async (
    path: string,
    options?: { activate?: boolean }
  ) => {
    if (!server || !canTransferFiles) {
      return;
    }

    const activate = options?.activate ?? true;
    const requestedPath = path.trim() ? normalizeRemotePath(path) : "";
    const requestId = activate ? activeDirectoryRequestRef.current + 1 : activeDirectoryRequestRef.current;

    if (activate) {
      activeDirectoryRequestRef.current = requestId;
      setIsLoadingRemoteEntries(true);
      setRemoteBrowserError(null);
      setRemoteBrowserPath(requestedPath);
    }

    try {
      const listing = await invoke<RemoteDirectoryListing>("list_remote_directory", {
        id: server.id,
        path: requestedPath,
      });

      if (activate && requestId !== activeDirectoryRequestRef.current) {
        return;
      }

      const normalizedListing = normalizeDirectoryListing(listing);
      const { currentPath, parentPath, entries } = normalizedListing;

      if (activate) {
        setRemoteBrowserPath(currentPath);
        setRemoteBrowserParentPath(parentPath);
        setRemoteEntries(entries);
      }
    } catch (error) {
      if (activate) {
        setRemoteBrowserError(getErrorMessage(error));
      }
    } finally {
      if (activate && requestId === activeDirectoryRequestRef.current) {
        setIsLoadingRemoteEntries(false);
      }
    }
  }, [canTransferFiles, server]);

  useEffect(() => {
    activeDirectoryRequestRef.current += 1;
    setUploadRemotePath("");
    setDownloadRemotePath("");
    setTransferStatus(null);
    setTransferError(null);
    setActiveTransfer(null);
    setRemoteBrowserPath("");
    setRemoteBrowserParentPath(null);
    setRemoteEntries([]);
    setRemoteBrowserError(null);
    setIsLoadingRemoteEntries(false);
    setIsCreatingDirectory(false);
    setNewDirectoryName("");
    setRenamingEntry(null);

    if (server && canTransferFiles && isOpen) {
      void loadRemoteDirectory("");
    }
  }, [canTransferFiles, isOpen, loadRemoteDirectory, server]);

  useEffect(() => {
    if (!isOpen || !server) {
      return;
    }

    let mounted = true;
    const unlistenPromise = listen<FileTransferProgressEvent>("file-transfer-progress", event => {
      if (!mounted) {
        return;
      }
      const payload = event.payload;
      updateTransfer(payload.transferId, {
        status: payload.status,
        progressPercent: payload.progressPercent,
        message: payload.message ?? undefined,
      });
    });

    return () => {
      mounted = false;
      void unlistenPromise.then(unlisten => unlisten());
    };
  }, [isOpen, server]);

  if (!isOpen) {
    return null;
  }

  const breadcrumbs = buildBreadcrumbs(remoteBrowserPath);

  const handleSelectDirectory = async (path: string) => {
    setDownloadRemotePath("");
    setTransferError(null);
    setRenamingEntry(null);
    await loadRemoteDirectory(path, { activate: true });
  };

  const handleUpload = async () => {
    if (!server || !canTransferFiles) {
      setTransferError(transferHint);
      return;
    }

    const selected = await open({
      directory: false,
      multiple: true,
      title: "选择要上传的本地文件",
    });

    if (!selected) {
      return;
    }

    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) {
      return;
    }

    setTransferStatus(null);
    setTransferError(null);
    setActiveTransfer("upload");

    for (const localPath of paths) {
      const fileName = getBaseName(localPath);
      const remotePath = uploadRemotePath.trim() || joinRemotePath(remoteBrowserPath || "/tmp", fileName);
      const transferId = createTransferId();

      setTransfers(prev => [
        ...prev,
        {
          transferId,
          fileName,
          direction: "upload",
          status: "preparing",
          progressPercent: 0,
          message: "准备上传",
        },
      ]);

      try {
        await invoke<FileTransferResult>("upload_file_to_server", {
          id: server.id,
          localPath,
          remotePath,
          transferId,
        });
        updateTransfer(transferId, { status: "completed", progressPercent: 100, message: "上传完成" });
      } catch (error) {
        updateTransfer(transferId, { status: "failed", message: getErrorMessage(error) });
      }
    }

    setActiveTransfer(null);
  };

  const handleDownload = async () => {
    if (!server || !canTransferFiles) {
      setTransferError(transferHint);
      return;
    }

    const remotePath = downloadRemotePath.trim();
    if (!remotePath) {
      setTransferError("请先在下方目录中选择远程文件。");
      return;
    }

    const selected = await save({
      title: "选择保存位置",
      defaultPath: getBaseName(remotePath),
    });

    if (typeof selected !== "string") {
      return;
    }

    setTransferStatus(null);
    setTransferError(null);
    setActiveTransfer("download");

    try {
      const result = await invoke<FileTransferResult>("download_file_from_server", {
        id: server.id,
        remotePath,
        localPath: selected,
      });
      setTransferStatus(result.message);
      setTransfers(prev => [
        ...prev,
        {
          transferId: createTransferId(),
          fileName: getBaseName(remotePath),
          direction: "download",
          status: "completed",
          progressPercent: 100,
          message: "下载完成",
        },
      ]);
    } catch (error) {
      setTransferError(getErrorMessage(error));
    } finally {
      setActiveTransfer(null);
    }
  };

  const handleCreateDirectory = async () => {
    const name = newDirectoryName.trim();
    if (!server || !name) {
      return;
    }

    try {
      await invoke("create_remote_directory", {
        id: server.id,
        path: joinRemotePath(remoteBrowserPath, name),
      });
      setIsCreatingDirectory(false);
      setNewDirectoryName("");
      await loadRemoteDirectory(remoteBrowserPath);
    } catch (error) {
      setRemoteBrowserError(getErrorMessage(error));
    }
  };

  const handleRename = async () => {
    const name = renameInput.trim();
    if (!server || !renamingEntry || !name) {
      return;
    }

    try {
      await invoke("rename_remote_path", {
        id: server.id,
        path: renamingEntry.path,
        newPath: joinRemotePath(remoteBrowserPath, name),
      });
      setRenamingEntry(null);
      setRenameInput("");
      await loadRemoteDirectory(remoteBrowserPath);
    } catch (error) {
      setRemoteBrowserError(getErrorMessage(error));
    }
  };

  const handleDelete = async (entry: RemoteDirectoryEntry) => {
    if (!server) {
      return;
    }

    const confirmed = await ask(
      `确定要删除远程路径 ${entry.path} 吗？${entry.isDir ? "目录会连同内容一并删除。" : ""}`,
      "删除确认",
    );
    if (!confirmed) {
      return;
    }

    try {
      await invoke("delete_remote_path", {
        id: server.id,
        path: entry.path,
        isDir: entry.isDir,
      });
      if (downloadRemotePath === entry.path) {
        setDownloadRemotePath("");
      }
      await loadRemoteDirectory(remoteBrowserPath);
    } catch (error) {
      setRemoteBrowserError(getErrorMessage(error));
    }
  };

  const clearFinishedTransfers = () => {
    setTransfers(prev => prev.filter(record => (
      record.status !== "completed" && record.status !== "failed"
    )));
  };

  return (
    <div className={styles.tray}>
      <div className={styles.header}>
        <div>
          <h3>文件传输</h3>
          <p className={styles.headerMeta}>
            {server ? `${server.name} · ${server.username}@${server.host}:${server.port}` : "未选择服务器"}
          </p>
        </div>
        <span className={styles.headerTag}>文件传输</span>
      </div>

      {transfers.length > 0 && (
        <div className={styles.transferList}>
          <div className={styles.transfersHeader}>
            <span>传输记录（{transfers.filter(t => t.status === "progress" || t.status === "preparing").length} 个进行中）</span>
            <button
              type="button"
              className={styles.clearTransfersButton}
              onClick={clearFinishedTransfers}
            >
              清除已完成
            </button>
          </div>
          {transfers.map(record => (
            <div key={record.transferId} className={styles.transferItem} data-status={record.status}>
              <div className={styles.transferItemTop}>
                <span className={styles.transferItemName}>
                  {record.direction === "upload" ? <FaUpload size={11} /> : <FaDownload size={11} />}
                  {record.fileName}
                </span>
                <span className={styles.transferItemStatus}>
                  {record.status === "completed" ? "完成" : record.status === "failed" ? "失败" : `${record.progressPercent}%`}
                </span>
              </div>
              {record.status === "progress" && (
                <div className={styles.transferItemBar}>
                  <div style={{ width: `${record.progressPercent}%` }} />
                </div>
              )}
              <div className={styles.transferItemMessage}>{record.message}</div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.controlBar}>
        <div className={styles.infoPill}>
          <span className={styles.infoLabel}>目标服务器</span>
          <strong>{server ? server.name : "未选择"}</strong>
        </div>
        <div className={styles.infoPill}>
          <span className={styles.infoLabel}>当前目录</span>
          <strong>{remoteBrowserPath}</strong>
        </div>
        <div className={styles.infoPill}>
          <span className={styles.infoLabel}>已选文件</span>
          <strong>{downloadRemotePath || "未选择"}</strong>
        </div>
      </div>

      <div className={styles.browserCard}>
        <div className={styles.browserTopBar}>
          <p className={styles.transferHint}>{transferHint}</p>

          <div className={styles.actionGrid}>
            <label className={styles.fieldBlock}>
              <span>上传目标</span>
              <input
                type="text"
                value={uploadRemotePath}
                onChange={event => setUploadRemotePath(event.target.value)}
                placeholder="留空时自动使用当前目录/文件名"
                disabled={!server}
              />
            </label>

            <label className={styles.fieldBlock}>
              <span>已选文件</span>
              <input
                type="text"
                value={downloadRemotePath}
                readOnly
                placeholder="请在下方目录中选择远程文件"
                disabled={!server}
              />
            </label>

            <div className={styles.transferActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  void handleUpload();
                }}
                disabled={activeTransfer !== null || !canTransferFiles}
              >
                <FaUpload />
                <span>{activeTransfer === "upload" ? "上传中..." : "上传到当前目录"}</span>
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  void handleDownload();
                }}
                disabled={activeTransfer !== null || !canTransferFiles}
              >
                <FaDownload />
                <span>{activeTransfer === "download" ? "下载中..." : "下载选中文件"}</span>
              </button>
            </div>
          </div>
      </div>
        <div className={styles.browserToolbar}>
          <button
            type="button"
            className={styles.browserButton}
            onClick={() => {
              if (remoteBrowserParentPath) {
                void loadRemoteDirectory(remoteBrowserParentPath);
              }
            }}
            disabled={!remoteBrowserParentPath || isLoadingRemoteEntries || !canTransferFiles}
          >
            返回上级
          </button>
          <button
            type="button"
            className={styles.browserButton}
            onClick={() => {
              void loadRemoteDirectory(remoteBrowserPath);
            }}
            disabled={isLoadingRemoteEntries || !canTransferFiles}
          >
            <FaRedo />
            <span>刷新</span>
          </button>
          <button
            type="button"
            className={styles.browserButton}
            onClick={() => {
              setIsCreatingDirectory(true);
              setNewDirectoryName("");
            }}
            disabled={!canTransferFiles}
          >
            <FaFolderPlus />
            <span>新建目录</span>
          </button>
        </div>

        {isCreatingDirectory && (
          <div className={styles.inlineForm}>
            <input
              type="text"
              value={newDirectoryName}
              onChange={event => setNewDirectoryName(event.target.value)}
              placeholder="目录名称"
              autoFocus
              onKeyDown={event => {
                if (event.key === "Enter") {
                  void handleCreateDirectory();
                } else if (event.key === "Escape") {
                  setIsCreatingDirectory(false);
                }
              }}
            />
            <button
              type="button"
              className={styles.browserButton}
              onClick={() => void handleCreateDirectory()}
              disabled={!newDirectoryName.trim()}
            >
              创建
            </button>
            <button
              type="button"
              className={styles.browserButton}
              onClick={() => setIsCreatingDirectory(false)}
            >
              取消
            </button>
          </div>
        )}

        {renamingEntry && (
          <div className={styles.inlineForm}>
            <input
              type="text"
              value={renameInput}
              onChange={event => setRenameInput(event.target.value)}
              placeholder="新名称"
              autoFocus
              onKeyDown={event => {
                if (event.key === "Enter") {
                  void handleRename();
                } else if (event.key === "Escape") {
                  setRenamingEntry(null);
                }
              }}
            />
            <button
              type="button"
              className={styles.browserButton}
              onClick={() => void handleRename()}
              disabled={!renameInput.trim()}
            >
              重命名
            </button>
            <button
              type="button"
              className={styles.browserButton}
              onClick={() => setRenamingEntry(null)}
            >
              取消
            </button>
          </div>
        )}

        <div className={styles.breadcrumbs}>
          {breadcrumbs.map(item => (
            <button
              key={item.path}
              type="button"
              className={styles.breadcrumbButton}
              data-active={item.path === remoteBrowserPath}
              onClick={() => {
                void handleSelectDirectory(item.path);
              }}
              disabled={!canTransferFiles}
            >
              {item.label}
            </button>
          ))}
        </div>

        {remoteBrowserError && (
          <div className={styles.feedback} data-tone="error">
            {remoteBrowserError}
          </div>
        )}

        <div className={styles.browserContent}>
          <div className={styles.listPanel}>
            <div className={styles.panelHeader}>当前目录内容</div>
            <div className={styles.directoryTable}>
              <div className={styles.tableTitle}>{remoteBrowserPath}</div>
              {isLoadingRemoteEntries ? (
                <div className={styles.browserEmpty}>正在加载远程目录...</div>
              ) : remoteEntries.length === 0 ? (
                <div className={styles.browserEmpty}>当前目录为空。</div>
              ) : (
                <div className={styles.browserList}>
                  {remoteEntries.map(entry => (
                    <div
                      key={entry.path}
                      className={styles.browserEntry}
                      data-selected={!entry.isDir && downloadRemotePath === entry.path}
                      onClick={() => {
                        if (entry.isDir) {
                          void handleSelectDirectory(entry.path);
                          return;
                        }

                        setDownloadRemotePath(entry.path);
                        setTransferError(null);
                      }}
                    >
                      <div className={styles.browserEntryMain}>
                        {entry.isDir ? (
                          <FaFolder className={styles.browserEntryIcon} />
                        ) : (
                          <FaFileAlt className={styles.browserEntryIcon} />
                        )}
                        <span className={styles.browserEntryName}>{entry.name}</span>
                      </div>
                      <span className={styles.browserEntryMeta}>
                        {entry.isDir ? "目录" : formatFileSize(entry.size)}
                      </span>
                      <div className={styles.browserEntryActions}>
                        <button
                          type="button"
                          className={styles.browserEntryAction}
                          title="重命名"
                          onClick={event => {
                            event.stopPropagation();
                            setRenamingEntry(entry);
                            setRenameInput(entry.name);
                          }}
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          className={styles.browserEntryAction}
                          title="删除"
                          onClick={event => {
                            event.stopPropagation();
                            void handleDelete(entry);
                          }}
                        >
                          <FaTrash size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {transferStatus && (
        <div className={styles.feedback} data-tone="success">
          {transferStatus}
        </div>
      )}
      {transferError && (
        <div className={styles.feedback} data-tone="error">
          {transferError}
        </div>
      )}
    </div>
  );
};
