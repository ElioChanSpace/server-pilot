import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FaTimes, FaSpinner, FaExclamationCircle, FaHdd, FaFolderOpen,
  FaArrowUp, FaFileAlt, FaSearch,
} from 'react-icons/fa';
import styles from './DiskAnalysisModal.module.css';

interface DiskUsage {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercent: number;
  mount: string;
}

interface DirUsage {
  path: string;
  name: string;
  sizeKb: number;
}

interface DiskAnalysisModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

type View =
  | { mode: 'mounts' }
  | { mode: 'dirs'; path: string }
  | { mode: 'files'; path: string };

const formatSize = (kb: number) => {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
};

export const DiskAnalysisModal: React.FC<DiskAnalysisModalProps> = ({ serverId, serverName, onClose }) => {
  const [view, setView] = useState<View>({ mode: 'mounts' });
  const [disks, setDisks] = useState<DiskUsage[]>([]);
  const [dirs, setDirs] = useState<DirUsage[]>([]);
  const [files, setFiles] = useState<DirUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minSizeMb, setMinSizeMb] = useState(50);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const loadMounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DiskUsage[]>('fetch_disk_usage', { id: serverId });
      if (mountedRef.current) setDisks(result);
    } catch (err) {
      if (mountedRef.current) setError(String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [serverId]);

  const loadDirs = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DirUsage[]>('fetch_dir_usage', { id: serverId, path });
      if (mountedRef.current) setDirs(result);
    } catch (err) {
      if (mountedRef.current) setError(String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [serverId]);

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DirUsage[]>('fetch_large_files', { id: serverId, path, minSizeMb });
      if (mountedRef.current) setFiles(result);
    } catch (err) {
      if (mountedRef.current) setError(String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [serverId, minSizeMb]);

  useEffect(() => {
    if (view.mode === 'mounts') void loadMounts();
    else if (view.mode === 'dirs') void loadDirs(view.path);
    else void loadFiles(view.path);
  }, [view, loadMounts, loadDirs, loadFiles]);

  const breadcrumb = useMemo(() => {
    if (view.mode === 'mounts') return [];
    const parts = view.path.split('/').filter(Boolean);
    const crumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [view]);

  const parentPath = useMemo(() => {
    if (view.mode !== 'dirs') return null;
    const idx = view.path.lastIndexOf('/');
    return idx > 0 ? view.path.slice(0, idx) : '/';
  }, [view]);

  const usageColor = (pct: number) =>
    pct >= 90 ? styles.barDanger : pct >= 70 ? styles.barWarn : styles.barOk;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaHdd size={14} />
            <span>磁盘分析</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.tabBtn} ${view.mode === 'mounts' ? styles.tabBtnActive : ''}`}
              onClick={() => setView({ mode: 'mounts' })}
            >
              磁盘占用
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${view.mode === 'dirs' ? styles.tabBtnActive : ''}`}
              onClick={() => setView({ mode: 'dirs', path: '/' })}
            >
              目录分析
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${view.mode === 'files' ? styles.tabBtnActive : ''}`}
              onClick={() => setView({ mode: 'files', path: '/' })}
            >
              大文件
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        {view.mode === 'dirs' && (
          <div className={styles.breadcrumbBar}>
            <button
              type="button"
              className={styles.upBtn}
              disabled={view.path === '/'}
              onClick={() => setView({ mode: 'dirs', path: parentPath ?? '/' })}
              title="上一级"
            >
              <FaArrowUp size={10} /> 上一级
            </button>
            <div className={styles.breadcrumb}>
              {breadcrumb.map((c, i) => (
                <React.Fragment key={c.path}>
                  {i > 0 && <span className={styles.crumbSep}>/</span>}
                  <button type="button" className={styles.crumb} onClick={() => setView({ mode: 'dirs', path: c.path })}>
                    {c.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {view.mode === 'files' && (
          <div className={styles.breadcrumbBar}>
            <span className={styles.filterLabel}>扫描目录</span>
            <input
              className={styles.pathInput}
              value={view.path}
              onChange={e => setView({ mode: 'files', path: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') void loadFiles(view.path); }}
            />
            <span className={styles.filterLabel}>大于</span>
            <input
              className={styles.sizeInput}
              type="number"
              min={1}
              value={minSizeMb}
              onChange={e => setMinSizeMb(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className={styles.filterLabel}>MB</span>
            <button type="button" className={styles.scanBtn} onClick={() => void loadFiles(view.path)}>
              <FaSearch size={10} /> 扫描
            </button>
          </div>
        )}

        <div className={styles.content}>
          {loading ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在分析磁盘...</p></div>
          ) : error ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => {
                  if (view.mode === 'mounts') void loadMounts();
                  else if (view.mode === 'dirs') void loadDirs(view.path);
                  else void loadFiles(view.path);
                }}
              >
                重试
              </button>
            </div>
          ) : view.mode === 'mounts' ? (
            <div className={styles.diskList}>
              {disks.map(d => (
                <div
                  key={d.mount}
                  className={styles.diskRow}
                  onClick={() => setView({ mode: 'dirs', path: d.mount })}
                  title={`点击分析 ${d.mount} 目录占用`}
                >
                  <div className={styles.diskHeader}>
                    <span className={styles.mount}>{d.mount}</span>
                    <span className={styles.fsName}>{d.filesystem}</span>
                    <span className={styles.diskNums}>{d.used} / {d.size}（可用 {d.avail}）</span>
                    <span className={`${styles.pct} ${d.usePercent >= 90 ? styles.pctDanger : d.usePercent >= 70 ? styles.pctWarn : ''}`}>
                      {d.usePercent}%
                    </span>
                  </div>
                  <div className={styles.barTrack}>
                    <div className={`${styles.barFill} ${usageColor(d.usePercent)}`} style={{ width: `${Math.min(100, d.usePercent)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : view.mode === 'dirs' ? (
            dirs.length === 0 ? (
              <div className={styles.state}><FaFolderOpen size={24} className={styles.emptyIcon} /><p>无子目录</p></div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>目录</th>
                    <th>大小</th>
                    <th>占比</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dirs.map(d => {
                    const total = dirs.reduce((sum, x) => sum + x.sizeKb, 0) || 1;
                    const pct = Math.round((d.sizeKb / total) * 100);
                    return (
                      <tr key={d.path} className={styles.clickableRow} onClick={() => setView({ mode: 'dirs', path: d.path })}>
                        <td className={styles.tdName}><FaFolderOpen size={11} className={styles.folderIcon} /> {d.name}</td>
                        <td>{formatSize(d.sizeKb)}</td>
                        <td>
                          <div className={styles.miniBarTrack}>
                            <div className={`${styles.miniBarFill} ${usageColor(pct)}`} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.linkBtn}
                            onClick={e => { e.stopPropagation(); setView({ mode: 'files', path: d.path }); }}
                          >
                            查大文件
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : files.length === 0 ? (
            <div className={styles.state}><FaFileAlt size={24} className={styles.emptyIcon} /><p>未找到符合条件的大文件</p></div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>文件</th>
                  <th>大小</th>
                  <th>路径</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.path}>
                    <td className={styles.tdName}><FaFileAlt size={11} className={styles.folderIcon} /> {f.name}</td>
                    <td>{formatSize(f.sizeKb)}</td>
                    <td className={styles.tdPath} title={f.path}>{f.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.footer}>
          {view.mode === 'mounts'
            ? `共 ${disks.length} 个挂载点 · 点击可下钻目录占用`
            : view.mode === 'dirs'
              ? `分析 ${view.path} · 点击目录下钻`
              : `扫描 ${view.path} 中大于 ${minSizeMb}MB 的文件`}
        </div>
      </div>
    </div>
  );
};
