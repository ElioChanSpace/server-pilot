import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  FaTimes, FaSpinner, FaExclamationCircle, FaFolder, FaFileAlt, FaArrowUp,
  FaSyncAlt, FaTrash, FaPen, FaFolderPlus, FaArrowRight, FaArrowLeft, FaHdd,
} from 'react-icons/fa';
import styles from './FileManagerModal.module.css';

interface PaneEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  mtime: number | null;
}

interface RemoteListingEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

interface RemoteDirectoryListing {
  currentPath: string;
  parentPath?: string | null;
  entries: RemoteListingEntry[];
}

interface FileManagerModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

const MAX_LOCAL_STAT = 300;

const formatSize = (bytes: number | null) => {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const formatTime = (ts: number | null) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const joinPath = (base: string, name: string) => (base === '/' ? `/${name}` : `${normalize(base)}/${name}`);

export const FileManagerModal: React.FC<FileManagerModalProps> = ({ serverId, serverName, onClose }) => {
  const [localPath, setLocalPath] = useState('');
  const [localEntries, setLocalEntries] = useState<PaneEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  const [remotePath, setRemotePath] = useState('/');
  const [remoteEntries, setRemoteEntries] = useState<PaneEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [activePane, setActivePane] = useState<'local' | 'remote'>('local');
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [remoteSelected, setRemoteSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const localHomeRef = useRef('');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  /* ---- Local pane ---- */
  const loadLocal = useCallback(async (path: string) => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const { readDir, stat } = await import('@tauri-apps/plugin-fs');
      const { homeDir } = await import('@tauri-apps/api/path');
      let target = path;
      if (!target) {
        const home = await homeDir();
        localHomeRef.current = home;
        target = home;
      }
      const dirEntries = await readDir(target);
      const sliced = dirEntries.slice(0, MAX_LOCAL_STAT);
      const detailed = await Promise.all(sliced.map(async entry => {
        const full = joinPath(target, entry.name);
        let size: number | null = null;
        let mtime: number | null = null;
        try {
          const info = await stat(full);
          size = entry.isDirectory ? null : Number(info.size ?? 0);
          mtime = info.mtime ? new Date(info.mtime).getTime() : null;
        } catch { /* stat may fail for broken symlinks */ }
        return {
          name: entry.name,
          path: full,
          isDir: entry.isDirectory,
          size,
          mtime,
        } as PaneEntry;
      }));
      detailed.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      setLocalEntries(detailed);
      setLocalPath(target);
      setLocalSelected(null);
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setLocalLoading(false);
    }
  }, []);

  /* ---- Remote pane ---- */
  const loadRemote = useCallback(async (path: string) => {
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const listing = await invoke<RemoteDirectoryListing>('list_remote_directory', {
        id: serverId,
        path,
      });
      const entries: PaneEntry[] = listing.entries.map(e => ({
        name: e.name,
        path: e.path,
        isDir: e.isDir,
        size: e.isDir ? null : e.size,
        mtime: null,
      }));
      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      setRemoteEntries(entries);
      setRemotePath(listing.currentPath);
      setRemoteSelected(null);
    } catch (err) {
      setRemoteError(String(err));
    } finally {
      setRemoteLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void loadLocal(''); }, [loadLocal]);
  useEffect(() => { void loadRemote('/'); }, [loadRemote]);

  const localParent = useMemo(() => {
    const idx = localPath.lastIndexOf('/');
    return idx > 0 ? localPath.slice(0, idx) : localPath;
  }, [localPath]);

  /* ---- Transfers ---- */
  const transferId = () => `fm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const handleUpload = useCallback(async () => {
    if (!localSelected) return;
    const entry = localEntries.find(e => e.path === localSelected);
    if (!entry) return;
    const remoteTarget = joinPath(remotePath, entry.name);
    setBusy('upload');
    setActionError(null);
    try {
      if (entry.isDir) {
        await invoke('upload_directory_to_server', {
          id: serverId, localPath: entry.path, remotePath: remoteTarget, transferId: transferId(),
        });
      } else {
        await invoke('upload_file_to_server', {
          id: serverId, localPath: entry.path, remotePath: remoteTarget, transferId: transferId(),
        });
      }
      await loadRemote(remotePath);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(null);
    }
  }, [localSelected, localEntries, remotePath, serverId, loadRemote]);

  const handleDownload = useCallback(async () => {
    if (!remoteSelected) return;
    const entry = remoteEntries.find(e => e.path === remoteSelected);
    if (!entry) return;
    if (entry.isDir) {
      setActionError('暂不支持整目录下载，请进入目录后逐个下载文件');
      return;
    }
    const localTarget = joinPath(localPath, entry.name);
    setBusy('download');
    setActionError(null);
    try {
      await invoke('download_file_from_server', {
        id: serverId, remotePath: entry.path, localPath: localTarget, transferId: transferId(),
      });
      await loadLocal(localPath);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(null);
    }
  }, [remoteSelected, remoteEntries, localPath, serverId, loadLocal]);

  /* ---- File operations ---- */
  const handleDelete = useCallback(async () => {
    const isLocal = activePane === 'local';
    const entry = isLocal
      ? localEntries.find(e => e.path === localSelected)
      : remoteEntries.find(e => e.path === remoteSelected);
    if (!entry) return;
    const confirmed = await confirm(`确定删除 ${entry.name}${entry.isDir ? '（及其全部内容）' : ''}？`, {
      title: '删除确认', kind: 'warning',
    });
    if (!confirmed) return;
    setBusy('delete');
    setActionError(null);
    try {
      if (isLocal) {
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(entry.path, { recursive: true });
        await loadLocal(localPath);
      } else {
        await invoke('delete_remote_path', { id: serverId, path: entry.path });
        await loadRemote(remotePath);
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(null);
    }
  }, [activePane, localEntries, remoteEntries, localSelected, remoteSelected, localPath, remotePath, serverId, loadLocal, loadRemote]);

  const handleRename = useCallback(async () => {
    const isLocal = activePane === 'local';
    const entry = isLocal
      ? localEntries.find(e => e.path === localSelected)
      : remoteEntries.find(e => e.path === remoteSelected);
    if (!entry) return;
    const next = window.prompt('重命名为：', entry.name);
    if (!next || next === entry.name) return;
    setBusy('rename');
    setActionError(null);
    try {
      if (isLocal) {
        const { rename } = await import('@tauri-apps/plugin-fs');
        await rename(entry.path, joinPath(localPath, next));
        await loadLocal(localPath);
      } else {
        await invoke('rename_remote_path', { id: serverId, path: entry.path, newPath: joinPath(remotePath, next) });
        await loadRemote(remotePath);
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(null);
    }
  }, [activePane, localEntries, remoteEntries, localSelected, remoteSelected, localPath, remotePath, serverId, loadLocal, loadRemote]);

  const handleMkdir = useCallback(async () => {
    const isLocal = activePane === 'local';
    const name = window.prompt('新建目录名：');
    if (!name) return;
    setBusy('mkdir');
    setActionError(null);
    try {
      if (isLocal) {
        const { mkdir } = await import('@tauri-apps/plugin-fs');
        await mkdir(joinPath(localPath, name));
        await loadLocal(localPath);
      } else {
        await invoke('create_remote_directory', { id: serverId, path: joinPath(remotePath, name) });
        await loadRemote(remotePath);
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(null);
    }
  }, [activePane, localPath, remotePath, serverId, loadLocal, loadRemote]);

  const renderPane = (
    side: 'local' | 'remote',
  ) => {
    const isLocal = side === 'local';
    const entries = isLocal ? localEntries : remoteEntries;
    const loading = isLocal ? localLoading : remoteLoading;
    const error = isLocal ? localError : remoteError;
    const path = isLocal ? localPath : remotePath;
    const selected = isLocal ? localSelected : remoteSelected;
    const setSelected = isLocal ? setLocalSelected : setRemoteSelected;
    const load = isLocal ? loadLocal : loadRemote;

    return (
      <div
        className={`${styles.pane} ${activePane === side ? styles.paneActive : ''}`}
        onClick={() => setActivePane(side)}
      >
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>{isLocal ? <FaHdd size={11} /> : <FaFolder size={11} />} {isLocal ? '本地' : '远程'}</span>
          <button
            type="button"
            className={styles.iconBtn}
            title="新建目录"
            onClick={e => { e.stopPropagation(); setActivePane(side); void handleMkdir(); }}
          >
            <FaFolderPlus size={11} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="重命名"
            disabled={!selected}
            onClick={e => { e.stopPropagation(); setActivePane(side); void handleRename(); }}
          >
            <FaPen size={11} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="删除"
            disabled={!selected}
            onClick={e => { e.stopPropagation(); setActivePane(side); void handleDelete(); }}
          >
            <FaTrash size={11} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="刷新"
            onClick={e => { e.stopPropagation(); void load(path); }}
          >
            {loading ? <FaSpinner size={11} className={styles.spin} /> : <FaSyncAlt size={11} />}
          </button>
        </div>
        <div className={styles.panePath} title={path}>
          <button
            type="button"
            className={styles.upBtn}
            disabled={isLocal ? path === localHomeRef.current || path === '/' : path === '/'}
            onClick={() => void load(isLocal ? localParent : path.split('/').slice(0, -1).join('/') || '/')}
            title="上一级"
          >
            <FaArrowUp size={10} />
          </button>
          <span className={styles.pathText}>{path || '…'}</span>
        </div>
        <div className={styles.paneBody}>
          {loading && entries.length === 0 ? (
            <div className={styles.paneState}><FaSpinner size={18} className={styles.spin} /><p>加载中...</p></div>
          ) : error ? (
            <div className={styles.paneState}>
              <FaExclamationCircle size={18} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void load(path)}>重试</button>
            </div>
          ) : entries.length === 0 ? (
            <div className={styles.paneState}><p>空目录</p></div>
          ) : (
            <table className={styles.paneTable}>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>大小</th>
                  {isLocal && <th>修改时间</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr
                    key={entry.path}
                    className={selected === entry.path ? styles.rowSelected : undefined}
                    onClick={() => setSelected(entry.path)}
                    onDoubleClick={() => {
                      if (entry.isDir) {
                        void load(entry.path);
                      } else {
                        setSelected(entry.path);
                      }
                    }}
                  >
                    <td className={styles.cellName}>
                      {entry.isDir ? <FaFolder size={11} className={styles.dirIcon} /> : <FaFileAlt size={11} className={styles.fileIcon} />}
                      <span title={entry.name}>{entry.name}</span>
                    </td>
                    <td className={styles.cellSize}>{entry.isDir ? '—' : formatSize(entry.size)}</td>
                    {isLocal && <td className={styles.cellTime}>{formatTime(entry.mtime)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaFolder size={14} />
            <span>文件管理器</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.transferBar}>
          <button
            type="button"
            className={styles.transferBtn}
            disabled={!localSelected || busy !== null}
            onClick={() => void handleUpload()}
            title="上传选中的本地文件/目录到远程当前目录"
          >
            {busy === 'upload' ? <FaSpinner size={11} className={styles.spin} /> : <FaArrowRight size={11} />}
            上传
          </button>
          <button
            type="button"
            className={styles.transferBtn}
            disabled={!remoteSelected || busy !== null}
            onClick={() => void handleDownload()}
            title="下载选中的远程文件到本地当前目录"
          >
            {busy === 'download' ? <FaSpinner size={11} className={styles.spin} /> : <FaArrowLeft size={11} />}
            下载
          </button>
          {actionError && <span className={styles.actionError}>{actionError}</span>}
          <span className={styles.hint}>双击目录进入 · 单击选中</span>
        </div>

        <div className={styles.panes}>
          {renderPane('local')}
          {renderPane('remote')}
        </div>
      </div>
    </div>
  );
};
