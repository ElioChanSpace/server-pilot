import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaTimes, FaSearch, FaSpinner, FaExclamationCircle, FaDocker, FaPlay, FaStop, FaRedo, FaScroll } from 'react-icons/fa';
import styles from './DockerManagerModal.module.css';

/** Icon button that avoids global `button` style conflicts */
const IconButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  title: string;
  className?: string;
  children: React.ReactNode;
}> = ({ onClick, disabled, title, className, children }) => (
  <div
    role="button"
    tabIndex={disabled ? -1 : 0}
    title={title}
    className={`${styles.iconBtn} ${className || ''}`}
    onClick={disabled ? undefined : onClick}
    onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
    aria-disabled={disabled}
  >
    {children}
  </div>
);

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

interface DockerManagerModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

const STATE_LABELS: Record<string, { label: string; className: string }> = {
  running: { label: '运行中', className: styles.stateRunning },
  exited: { label: '已停止', className: styles.stateExited },
  paused: { label: '已暂停', className: styles.statePaused },
  restarting: { label: '重启中', className: styles.stateRestarting },
  created: { label: '已创建', className: styles.stateCreated },
};

export const DockerManagerModal: React.FC<DockerManagerModalProps> = ({ serverId, serverName, onClose }) => {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ containerId: string; name: string; content: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DockerContainer[]>('fetch_docker_containers', { id: serverId });
      setContainers(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void fetchContainers(); }, [fetchContainers]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleAction = useCallback(async (containerId: string, action: string) => {
    setActionLoading(`${containerId}-${action}`);
    try {
      await invoke('docker_container_action', { id: serverId, containerId, action });
      await fetchContainers();
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(null);
    }
  }, [serverId, fetchContainers]);

  const handleLogs = useCallback(async (containerId: string, name: string) => {
    try {
      const content = await invoke<string>('fetch_docker_logs', { id: serverId, containerId, tail: 200 });
      setLogs({ containerId, name, content });
    } catch (err) {
      setError(String(err));
    }
  }, [serverId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return containers;
    const q = search.trim().toLowerCase();
    return containers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      c.state.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q)
    );
  }, [containers, search]);

  const renderState = (state: string) => {
    const info = STATE_LABELS[state] || { label: state, className: '' };
    return <span className={`${styles.stateTag} ${info.className}`}>{info.label}</span>;
  };

  const renderActions = (c: DockerContainer) => {
    const isRunning = c.state === 'running';
    const isLoading = (a: string) => actionLoading === `${c.id}-${a}`;
    return (
      <div className={styles.actions}>
        {isRunning ? (
          <>
            <IconButton
              onClick={() => void handleAction(c.id, 'stop')}
              disabled={isLoading('stop')}
              title="停止"
            >
              {isLoading('stop') ? <FaSpinner size={10} className={styles.spin} /> : <FaStop size={10} />}
            </IconButton>
            <IconButton
              onClick={() => void handleAction(c.id, 'restart')}
              disabled={isLoading('restart')}
              title="重启"
            >
              {isLoading('restart') ? <FaSpinner size={10} className={styles.spin} /> : <FaRedo size={10} />}
            </IconButton>
          </>
        ) : (
          <IconButton
            onClick={() => void handleAction(c.id, 'start')}
            disabled={isLoading('start')}
            title="启动"
            className={styles.actionStart}
          >
            {isLoading('start') ? <FaSpinner size={10} className={styles.spin} /> : <FaPlay size={10} />}
          </IconButton>
        )}
        <IconButton
          onClick={() => void handleLogs(c.id, c.name)}
          title="日志"
        >
          <FaScroll size={10} />
        </IconButton>
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaDocker size={14} />
            <span>Docker 管理</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchContainers()} disabled={loading} title="刷新">
              {loading ? <FaSpinner size={12} className={styles.spin} /> : '刷新'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.searchBar}>
          <FaSearch size={11} className={styles.searchIcon} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            placeholder="搜索容器名、镜像、状态..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { if (search) { e.stopPropagation(); setSearch(''); } else { onClose(); } } }}
          />
          {search && (
            <button type="button" className={styles.searchClear} onClick={() => setSearch('')}><FaTimes size={9} /></button>
          )}
        </div>

        <div className={styles.content}>
          {loading && containers.length === 0 ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在获取容器信息...</p></div>
          ) : error ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchContainers()}>重试</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.state}><FaDocker size={24} className={styles.emptyIcon} /><p>{search ? '无匹配结果' : '无 Docker 容器'}</p></div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>镜像</th>
                  <th>状态</th>
                  <th>端口</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td className={styles.tdName} title={c.name}>{c.name}</td>
                    <td className={styles.tdImage} title={c.image}>{c.image}</td>
                    <td>{renderState(c.state)}</td>
                    <td className={styles.tdPorts} title={c.ports || '—'}>{c.ports || '—'}</td>
                    <td>{renderActions(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && (
          <div className={styles.footer}>
            {search ? `匹配 ${filtered.length} / ${containers.length} 个容器` : `共 ${containers.length} 个容器`}
          </div>
        )}

        {logs && (
          <div className={styles.logsOverlay} onClick={() => setLogs(null)}>
            <div className={styles.logsPanel} onClick={e => e.stopPropagation()}>
              <div className={styles.logsHeader}>
                <span className={styles.logsTitle}>📋 {logs.name} — 最近日志</span>
                <button type="button" className={styles.closeBtn} onClick={() => setLogs(null)}><FaTimes size={13} /></button>
              </div>
              <pre className={styles.logsContent}>{logs.content || '（无日志）'}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
