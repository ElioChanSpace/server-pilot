import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaTimes, FaSearch, FaSpinner, FaExclamationCircle, FaCogs, FaPlay, FaStop, FaRedo, FaScroll } from 'react-icons/fa';
import styles from './ServiceManagerModal.module.css';

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

interface SystemService {
  name: string;
  displayName: string;
  active: string;
  sub: string;
  description: string;
}

interface ServiceManagerModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export const ServiceManagerModal: React.FC<ServiceManagerModalProps> = ({ serverId, serverName, onClose }) => {
  const [services, setServices] = useState<SystemService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SystemService[]>('fetch_system_services', { id: serverId });
      setServices(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleAction = useCallback(async (serviceName: string, action: string) => {
    setActionLoading(`${serviceName}-${action}`);
    try {
      await invoke('system_service_action', { id: serverId, serviceName, action });
      await fetchServices();
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(null);
    }
  }, [serverId, fetchServices]);

  const handleLogs = useCallback(async (serviceName: string) => {
    try {
      const content = await invoke<string>('fetch_service_logs', { id: serverId, serviceName, tail: 200 });
      setLogs({ name: serviceName, content });
    } catch (err) {
      setError(String(err));
    }
  }, [serverId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return services;
    const q = search.trim().toLowerCase();
    return services.filter(s =>
      s.displayName.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.active.toLowerCase().includes(q)
    );
  }, [services, search]);

  const renderActive = (active: string) => {
    const cls = active === 'active' ? styles.activeOn : active === 'failed' ? styles.activeFailed : styles.activeOff;
    return <span className={`${styles.activeTag} ${cls}`}>{active}</span>;
  };

  const renderActions = (s: SystemService) => {
    const isActive = s.active === 'active';
    const isLoading = (a: string) => actionLoading === `${s.name}-${a}`;
    return (
      <div className={styles.actions}>
        {isActive ? (
          <>
            <IconButton
              onClick={() => void handleAction(s.name, 'stop')}
              disabled={isLoading('stop')}
              title="停止"
            >
              {isLoading('stop') ? <FaSpinner size={10} className={styles.spin} /> : <FaStop size={10} />}
            </IconButton>
            <IconButton
              onClick={() => void handleAction(s.name, 'restart')}
              disabled={isLoading('restart')}
              title="重启"
            >
              {isLoading('restart') ? <FaSpinner size={10} className={styles.spin} /> : <FaRedo size={10} />}
            </IconButton>
          </>
        ) : (
          <IconButton
            onClick={() => void handleAction(s.name, 'start')}
            disabled={isLoading('start')}
            title="启动"
            className={styles.actionStart}
          >
            {isLoading('start') ? <FaSpinner size={10} className={styles.spin} /> : <FaPlay size={10} />}
          </IconButton>
        )}
        <IconButton
          onClick={() => void handleLogs(s.name)}
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
            <FaCogs size={14} />
            <span>服务管理</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchServices()} disabled={loading} title="刷新">
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
            placeholder="搜索服务名、描述..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { if (search) { e.stopPropagation(); setSearch(''); } else { onClose(); } } }}
          />
          {search && (
            <button type="button" className={styles.searchClear} onClick={() => setSearch('')}><FaTimes size={9} /></button>
          )}
        </div>

        <div className={styles.content}>
          {loading && services.length === 0 ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在获取服务列表...</p></div>
          ) : error ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchServices()}>重试</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.state}><FaCogs size={24} className={styles.emptyIcon} /><p>{search ? '无匹配结果' : '无系统服务'}</p></div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>服务名</th>
                  <th>状态</th>
                  <th>描述</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.name}>
                    <td className={styles.tdName} title={s.name}>{s.displayName}</td>
                    <td>{renderActive(s.active)}</td>
                    <td className={styles.tdDesc} title={s.description}>{s.description || '—'}</td>
                    <td>{renderActions(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && (
          <div className={styles.footer}>
            {search ? `匹配 ${filtered.length} / ${services.length} 个服务` : `共 ${services.length} 个服务`}
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
