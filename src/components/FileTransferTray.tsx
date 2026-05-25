import React from "react";
import { open, save } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";
import { FaDownload, FaFileAlt, FaFolder, FaRedo, FaUpload } from "react-icons/fa";
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

interface DirectoryTreeNode {
  path: string;
  name: string;
  children: DirectoryTreeNode[];
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

  const units = ["B", "KB", "MB", "GB"];
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

const buildDirectoryTree = (
  path: string,
  cache: Record<string, RemoteDirectoryListing>
): DirectoryTreeNode[] => {
  const listing = cache[path];
  if (!listing) {
    return [];
  }

  return listing.entries
    .filter(entry => entry.isDir)
    .map(entry => ({
      path: entry.path,
      name: entry.name,
      children: buildDirectoryTree(entry.path, cache),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
};

const getAncestorPaths = (path: string) => {
  if (path === "/") {
    return ["/"];
  }

  const segments = path.split("/").filter(Boolean);
  return [
    "/",
    ...segments.map((_, index) => `/${segments.slice(0, index + 1).join("/")}`),
  ];
};

export const FileTransferTray: React.FC<FileTransferTrayProps> = ({ isOpen, server }) => {
  const [uploadRemotePath, setUploadRemotePath] = React.useState("");
  const [downloadRemotePath, setDownloadRemotePath] = React.useState("");
  const [transferStatus, setTransferStatus] = React.useState<string | null>(null);
  const [transferError, setTransferError] = React.useState<string | null>(null);
  const [activeTransfer, setActiveTransfer] = React.useState<"upload" | "download" | null>(null);
  const [remoteBrowserPath, setRemoteBrowserPath] = React.useState("/");
  const [remoteBrowserParentPath, setRemoteBrowserParentPath] = React.useState<string | null>(null);
  const [remoteEntries, setRemoteEntries] = React.useState<RemoteDirectoryEntry[]>([]);
  const [remoteBrowserError, setRemoteBrowserError] = React.useState<string | null>(null);
  const [isLoadingRemoteEntries, setIsLoadingRemoteEntries] = React.useState(false);
  const [directoryCache, setDirectoryCache] = React.useState<Record<string, RemoteDirectoryListing>>({});
  const [expandedPaths, setExpandedPaths] = React.useState<string[]>(["/"]);

  const isLinux = server?.osType === "linux";
  const hasSavedPassword = Boolean(server?.password);
  const canTransferFiles = Boolean(server) && isLinux && hasSavedPassword;
  const transferHint = !server
    ? "先在左侧或会话区域选中一台服务器，再使用底部文件传输模块。"
    : !isLinux
      ? "当前仅支持 Linux 服务器传输文件。"
      : !hasSavedPassword
        ? "请先为当前服务器保存 SSH 密码，再执行上传或下载。"
        : "支持本地与服务器之间的单文件上传、下载，并可按目录层级浏览远程文件。";

  const loadRemoteDirectory = React.useCallback(async (path: string) => {
    if (!server || !canTransferFiles) {
      return;
    }

    setIsLoadingRemoteEntries(true);
    setRemoteBrowserError(null);

    try {
      const listing = await invoke<RemoteDirectoryListing>("list_remote_directory", {
        id: server.id,
        path,
      });
      setRemoteBrowserPath(listing.currentPath);
      setRemoteBrowserParentPath(listing.parentPath ?? null);
      setRemoteEntries(listing.entries);
      setDirectoryCache(prev => ({
        ...prev,
        [listing.currentPath]: listing,
      }));
      setExpandedPaths(prev => Array.from(new Set([...prev, ...getAncestorPaths(listing.currentPath)])));
    } catch (error) {
      setRemoteBrowserError(getErrorMessage(error));
    } finally {
      setIsLoadingRemoteEntries(false);
    }
  }, [canTransferFiles, server]);

  React.useEffect(() => {
    setUploadRemotePath("");
    setDownloadRemotePath("");
    setTransferStatus(null);
    setTransferError(null);
    setActiveTransfer(null);
    setRemoteBrowserPath("/");
    setRemoteBrowserParentPath(null);
    setRemoteEntries([]);
    setRemoteBrowserError(null);
    setIsLoadingRemoteEntries(false);
    setDirectoryCache({});
    setExpandedPaths(["/"]);

    if (server && canTransferFiles && isOpen) {
      void loadRemoteDirectory("/");
    }
  }, [canTransferFiles, isOpen, loadRemoteDirectory, server]);

  if (!isOpen) {
    return null;
  }

  const breadcrumbs = buildBreadcrumbs(remoteBrowserPath);
  const currentDirectories = remoteEntries.filter(entry => entry.isDir);
  const currentFiles = remoteEntries.filter(entry => !entry.isDir);
  const directoryTree = buildDirectoryTree("/", directoryCache);

  const handleSelectDirectory = async (path: string) => {
    setDownloadRemotePath("");
    setTransferError(null);
    await loadRemoteDirectory(path);
  };

  const toggleDirectoryExpansion = async (path: string) => {
    const isExpanded = expandedPaths.includes(path);
    if (isExpanded && path !== remoteBrowserPath) {
      setExpandedPaths(prev => prev.filter(item => item !== path));
      return;
    }

    if (!directoryCache[path]) {
      await loadRemoteDirectory(path);
    } else {
      setExpandedPaths(prev => (prev.includes(path) ? prev : [...prev, path]));
    }
  };

  const renderTreeNodes = (nodes: DirectoryTreeNode[], depth = 0): React.ReactNode =>
    nodes.map(node => {
      const isExpanded = expandedPaths.includes(node.path);
      const isActive = remoteBrowserPath === node.path;

      return (
        <div key={node.path} className={styles.treeNode}>
          <button
            type="button"
            className={styles.treeButton}
            data-active={isActive}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => {
              void handleSelectDirectory(node.path);
            }}
            disabled={!canTransferFiles}
          >
            <span
              className={styles.treeCaret}
              data-expanded={isExpanded}
              onClick={event => {
                event.stopPropagation();
                void toggleDirectoryExpansion(node.path);
              }}
            >
              ▸
            </span>
            <FaFolder className={styles.treeIcon} />
            <span className={styles.treeLabel}>{node.name}</span>
          </button>
          {isExpanded && node.children.length > 0 && (
            <div className={styles.treeChildren}>{renderTreeNodes(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });

  const handleUpload = async () => {
    if (!server || !canTransferFiles) {
      setTransferError(transferHint);
      return;
    }

    const selected = await open({
      directory: false,
      multiple: false,
      title: "选择要上传的本地文件",
    });

    if (typeof selected !== "string") {
      return;
    }

    const remotePath = uploadRemotePath.trim() || joinRemotePath(remoteBrowserPath || "/tmp", getBaseName(selected));
    setUploadRemotePath(remotePath);
    setTransferStatus(null);
    setTransferError(null);
    setActiveTransfer("upload");

    try {
      const result = await invoke<FileTransferResult>("upload_file_to_server", {
        id: server.id,
        localPath: selected,
        remotePath,
      });
      setTransferStatus(result.message);
    } catch (error) {
      setTransferError(getErrorMessage(error));
    } finally {
      setActiveTransfer(null);
    }
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
    } catch (error) {
      setTransferError(getErrorMessage(error));
    } finally {
      setActiveTransfer(null);
    }
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
        <span className={styles.headerTag}>SCP</span>
      </div>

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
        </div>

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
          <div className={styles.treePanel}>
            <div className={styles.panelHeader}>目录树</div>
            {!server ? (
              <div className={styles.browserEmpty}>请选择一台服务器后再进行文件传输。</div>
            ) : (
              <div className={styles.treeRoot}>
                <button
                  type="button"
                  className={styles.treeButton}
                  data-active={remoteBrowserPath === "/"}
                  onClick={() => {
                    void handleSelectDirectory("/");
                  }}
                  disabled={!canTransferFiles}
                >
                  <span
                    className={styles.treeCaret}
                    data-expanded={expandedPaths.includes("/")}
                    onClick={event => {
                      event.stopPropagation();
                      void toggleDirectoryExpansion("/");
                    }}
                  >
                    ▸
                  </span>
                  <FaFolder className={styles.treeIcon} />
                  <span className={styles.treeLabel}>/</span>
                </button>
                {expandedPaths.includes("/") && directoryTree.length > 0 && (
                  <div className={styles.treeChildren}>{renderTreeNodes(directoryTree, 1)}</div>
                )}
              </div>
            )}
          </div>

          <div className={styles.listPanel}>
            <div className={styles.panelHeader}>当前目录内容</div>
            {isLoadingRemoteEntries ? (
              <div className={styles.browserEmpty}>正在加载远程目录...</div>
            ) : remoteEntries.length === 0 ? (
              <div className={styles.browserEmpty}>当前目录为空。</div>
            ) : (
              <div className={styles.listColumns}>
                <div className={styles.listSection}>
                  <div className={styles.listSectionTitle}>子目录</div>
                  <div className={styles.browserList}>
                    {currentDirectories.length > 0 ? currentDirectories.map(entry => (
                      <button
                        key={entry.path}
                        type="button"
                        className={styles.browserEntry}
                        onClick={() => {
                          void handleSelectDirectory(entry.path);
                        }}
                        disabled={!canTransferFiles}
                      >
                        <div className={styles.browserEntryMain}>
                          <FaFolder className={styles.browserEntryIcon} />
                          <span className={styles.browserEntryName}>{entry.name}</span>
                        </div>
                        <span className={styles.browserEntryMeta}>目录</span>
                      </button>
                    )) : (
                      <div className={styles.browserEmpty}>当前层级没有子目录。</div>
                    )}
                  </div>
                </div>

                <div className={styles.listSection}>
                  <div className={styles.listSectionTitle}>文件</div>
                  <div className={styles.browserList}>
                    {currentFiles.length > 0 ? currentFiles.map(entry => (
                      <button
                        key={entry.path}
                        type="button"
                        className={styles.browserEntry}
                        data-selected={downloadRemotePath === entry.path}
                        onClick={() => {
                          setDownloadRemotePath(entry.path);
                          setTransferError(null);
                        }}
                        disabled={!canTransferFiles}
                      >
                        <div className={styles.browserEntryMain}>
                          <FaFileAlt className={styles.browserEntryIcon} />
                          <span className={styles.browserEntryName}>{entry.name}</span>
                        </div>
                        <span className={styles.browserEntryMeta}>{formatFileSize(entry.size)}</span>
                      </button>
                    )) : (
                      <div className={styles.browserEmpty}>当前层级没有文件。</div>
                    )}
                  </div>
                </div>
              </div>
            )}
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
