import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaTimes, FaSpinner, FaExclamationCircle, FaPlay, FaPause, FaEraser, FaFilter, FaArrowDown } from 'react-icons/fa';
import styles from './LogStreamModal.module.css';

interface LogChunk {
  content: string;
  nextOffset: number;
  fileSize: number;
}

interface LogStreamModalProps {
  serverId: string;
  serverName: string;
  initialPath?: string;
  onClose: () => void;
}

const MAX_LINES = 5000;
const POLL_INTERVAL_MS = 1500;

export const LogStreamModal: React.FC<LogStreamModalProps> = ({ serverId, serverName, initialPath = '/var/log/syslog', onClose }) => {
  const [path, setPath] = useState(initialPath);
  const [streaming, setStreaming] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef(path);
  const streamingRef = useRef(false);

  useEffect(() => { pathRef.current = path; }, [path]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const poll = useCallback(async () => {
    if (!streamingRef.current) return;
    try {
      const chunk = await invoke<LogChunk>('read_log_chunk', {
        id: serverId,
        path: pathRef.current,
        offset: offsetRef.current,
      });
      setError(null);
      // 文件被轮转/截断（size 小于当前偏移）→ 重新从末尾开始
      if (offsetRef.current !== null && chunk.fileSize < offsetRef.current) {
        offsetRef.current = null;
        return;
      }
      offsetRef.current = chunk.nextOffset;
      if (chunk.content) {
        const incoming = chunk.content.split('\n');
        setLines(prev => {
          // tail 输出末尾若无换行，最后一条与下一批的首条需要拼接
          const merged = prev.length > 0 && !chunk.content.startsWith('\n') && prev[prev.length - 1] !== ''
            ? [...prev.slice(0, -1), prev[prev.length - 1] + incoming[0], ...incoming.slice(1)]
            : [...prev, ...incoming];
          return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
        });
      }
    } catch (err) {
      setError(String(err));
      setStreaming(false);
    }
  }, [serverId]);

  const startStream = useCallback(async () => {
    setLines([]);
    offsetRef.current = null;
    setError(null);
    setLoading(true);
    setStreaming(true);
    streamingRef.current = true;
    await poll();
    setLoading(false);
  }, [poll]);

  const stopStream = useCallback(() => {
    setStreaming(false);
    streamingRef.current = false;
  }, []);

  // Polling loop
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [streaming, poll]);

  // Auto-scroll when following
  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const visibleLines = filter.trim()
    ? lines.filter(l => l.toLowerCase().includes(filter.trim().toLowerCase()))
    : lines;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaPlay size={12} />
            <span>实时日志</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <input
            className={styles.pathInput}
            value={path}
            onChange={e => setPath(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !streaming) void startStream();
            }}
            placeholder="/var/log/syslog 或 journalctl 路径"
            disabled={streaming}
          />
          {streaming ? (
            <button type="button" className={styles.controlBtn} onClick={stopStream}>
              <FaPause size={10} /> 暂停
            </button>
          ) : (
            <button type="button" className={`${styles.controlBtn} ${styles.primary}`} onClick={() => void startStream()}>
              {loading ? <FaSpinner size={10} className={styles.spin} /> : <FaPlay size={10} />} 开始跟踪
            </button>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            title="清空视图"
            onClick={() => setLines([])}
          >
            <FaEraser size={11} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${follow ? styles.iconBtnActive : ''}`}
            title={follow ? '关闭自动滚动' : '开启自动滚动'}
            onClick={() => setFollow(prev => !prev)}
          >
            <FaArrowDown size={11} />
          </button>
          <div className={styles.filterBox}>
            <FaFilter size={10} className={styles.filterIcon} />
            <input
              className={styles.filterInput}
              placeholder="过滤显示..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.logArea} ref={scrollRef}>
          {error ? (
            <div className={styles.errorBanner}><FaExclamationCircle size={12} /> {error}</div>
          ) : null}
          {visibleLines.length === 0 && !error ? (
            <div className={styles.emptyHint}>
              {streaming ? '等待日志输出...' : '输入日志文件路径，点击「开始跟踪」实时查看新增日志'}
            </div>
          ) : (
            visibleLines.map((line, i) => (
              <div key={i} className={styles.logLine}>{line || '\u00A0'}</div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span>{lines.length} 行{filter ? `（过滤后 ${visibleLines.length} 行）` : ''}</span>
          <span className={styles.footerStatus}>
            {streaming ? <span className={styles.liveDot} /> : null}
            {streaming ? '跟踪中' : '已暂停'}
          </span>
        </div>
      </div>
    </div>
  );
};
