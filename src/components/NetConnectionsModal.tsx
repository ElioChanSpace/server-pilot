import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FaTimes, FaSearch, FaSpinner, FaExclamationCircle, FaNetworkWired,
} from 'react-icons/fa';
import styles from './NetConnectionsModal.module.css';

interface NetConnection {
  proto: string;
  state: string;
  recvQ: number;
  sendQ: number;
  local: string;
  peer: string;
  process: string;
  pid: number | null;
}

interface NetConnectionsModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

type Filter = 'all' | 'tcp' | 'udp' | 'listen' | 'established' | 'other';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'tcp', label: 'TCP' },
  { id: 'udp', label: 'UDP' },
  { id: 'listen', label: 'LISTEN' },
  { id: 'established', label: 'ESTAB' },
  { id: 'other', label: '其他状态' },
];

const stateTone = (state: string) => {
  const s = state.toUpperCase();
  if (s === 'LISTEN') return styles.stateListen;
  if (s === 'ESTAB') return styles.stateEstablished;
  if (s === 'TIME-WAIT') return styles.stateTimewait;
  if (s === 'CLOSE-WAIT' || s === 'FIN-WAIT-2') return styles.stateWarn;
  return styles.stateOther;
};

export const NetConnectionsModal: React.FC<NetConnectionsModalProps> = ({ serverId, serverName, onClose }) => {
  const [connections, setConnections] = useState<NetConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchConnections = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await invoke<NetConnection[]>('fetch_network_connections', { id: serverId });
      setConnections(result);
    } catch (err) {
      setError(String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => { void fetchConnections(true); }, 4000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchConnections]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return connections.filter(c => {
      if (filter === 'tcp' && !c.proto.startsWith('tcp')) return false;
      if (filter === 'udp' && !c.proto.startsWith('udp')) return false;
      if (filter === 'listen' && c.state.toUpperCase() !== 'LISTEN') return false;
      if (filter === 'established' && c.state.toUpperCase() !== 'ESTAB') return false;
      if (filter === 'other') {
        const s = c.state.toUpperCase();
        if (s === 'LISTEN' || s === 'ESTAB') return false;
      }
      if (!q) return true;
      return (
        c.local.toLowerCase().includes(q) ||
        c.peer.toLowerCase().includes(q) ||
        c.process.toLowerCase().includes(q) ||
        String(c.pid ?? '').includes(q) ||
        c.state.toLowerCase().includes(q)
      );
    });
  }, [connections, filter, search]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaNetworkWired size={14} />
            <span>网络连接</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.autoBtn} ${autoRefresh ? styles.autoBtnOn : ''}`}
              onClick={() => setAutoRefresh(prev => !prev)}
              title={autoRefresh ? '关闭自动刷新' : '开启自动刷新（4 秒）'}
            >
              自动刷新{autoRefresh ? ' · 开' : ' · 关'}
            </button>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchConnections()} disabled={loading} title="刷新">
              {loading ? <FaSpinner size={12} className={styles.spin} /> : '刷新'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.chips}>
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                className={`${styles.chip} ${filter === f.id ? styles.chipActive : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={styles.searchBar}>
            <FaSearch size={11} className={styles.searchIcon} />
            <input
              ref={searchRef}
              className={styles.searchInput}
              placeholder="搜索地址、端口、进程..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { if (search) { e.stopPropagation(); setSearch(''); } else { onClose(); } } }}
            />
            {search && (
              <button type="button" className={styles.searchClear} onClick={() => setSearch('')}><FaTimes size={9} /></button>
            )}
          </div>
        </div>

        <div className={styles.content}>
          {loading && connections.length === 0 ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在获取网络连接...</p></div>
          ) : error && connections.length === 0 ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchConnections()}>重试</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.state}><FaNetworkWired size={24} className={styles.emptyIcon} /><p>无匹配连接</p></div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>协议</th>
                  <th>状态</th>
                  <th>本地地址</th>
                  <th>对端地址</th>
                  <th>进程</th>
                  <th>队列 (R/S)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={`${c.proto}-${c.local}-${c.peer}-${i}`}>
                    <td className={styles.tdProto}>{c.proto}</td>
                    <td><span className={`${styles.stateTag} ${stateTone(c.state)}`}>{c.state || '—'}</span></td>
                    <td className={styles.tdAddr}>{c.local}</td>
                    <td className={styles.tdAddr}>{c.peer}</td>
                    <td className={styles.tdProcess} title={c.process || '—'}>
                      {c.process || '—'}{c.pid !== null && <span className={styles.pid}> · {c.pid}</span>}
                    </td>
                    <td className={styles.tdQueue}>{c.recvQ} / {c.sendQ}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error && connections.length > 0 && <div className={styles.errorBar}>{error}</div>}
        <div className={styles.footer}>
          {search || filter !== 'all' ? `匹配 ${filtered.length} / ${connections.length} 个连接` : `共 ${connections.length} 个连接`}
        </div>
      </div>
    </div>
  );
};
