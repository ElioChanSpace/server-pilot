import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import {
  FaTimes, FaSearch, FaSpinner, FaExclamationCircle, FaMicrochip,
  FaSort, FaSortUp, FaSortDown, FaSkullCrossbones, FaStop, FaPlay,
} from 'react-icons/fa';
import { useSteadyRanking, RankedEntry } from '../hooks/useSteadyRanking';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePolling } from '../hooks/usePolling';
import ProcessDetailCard, { ProcessDetailData } from './metrics/ProcessDetailCard';
import styles from './ProcessManagerModal.module.css';

interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  rssKb: number;
  stat: string;
  etime: string;
  command: string;
}

interface ProcessManagerModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

type SortKey = 'pid' | 'user' | 'cpu' | 'mem' | 'rssKb' | 'etime' | 'command';

const formatRss = (kb: number) => {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
};

/** 实时读数列（CPU/内存）在降序时用"要静的列表"排名；其它列为普通排序 */
const isLiveRanking = (sortKey: SortKey, sortDesc: boolean) =>
  sortDesc && (sortKey === 'cpu' || sortKey === 'mem');

const isClearlyAheadFor = (sortKey: SortKey) =>
  sortKey === 'mem'
    ? (challenger: number, incumbent: number) => challenger > incumbent * 1.04 + 1
    : (challenger: number, incumbent: number) => challenger > incumbent * 1.12 + 1;

interface ProcessRowProps {
  entry: RankedEntry<ProcessInfo>;
  live: boolean;
  reduced: boolean;
  cardOpen: boolean;
  actionPid: number | null;
  onRowClick: (proc: ProcessInfo, element: HTMLElement | null) => void;
  onSignal: (proc: ProcessInfo, signal: 'term' | 'kill' | 'stop' | 'cont') => void;
}

/**
 * 一行 = 按压反馈 + 移动方式：
 * 相邻交换滑过（layout spring）；跨多行原地翻页（不横穿列表）；
 * 新进入淡入。见 docs/design/principles.md §3。
 */
const ProcessRow: React.FC<ProcessRowProps> = ({
  entry,
  live,
  reduced,
  cardOpen,
  actionPid,
  onRowClick,
  onSignal,
}) => {
  const p = entry.item;
  const controls = useAnimationControls();

  useEffect(() => {
    if (!live || reduced || entry.move !== 'turnover') {
      return;
    }
    void controls.start({
      opacity: [0, 1],
      y: [6, 0],
      transition: { duration: 0.22, ease: 'easeOut' },
    });
  }, [entry.moveSeq, entry.move, live, reduced, controls]);

  const isEntering = live && !reduced && entry.move === 'enter';

  return (
    <motion.tr
      layout={live && !reduced && entry.move === 'slide'}
      transition={{ type: 'spring', stiffness: 480, damping: 38, mass: 0.6 }}
      initial={isEntering ? { opacity: 0 } : false}
      animate={isEntering ? { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } } : undefined}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      whileTap={{ scale: 0.985 }}
      data-process-row={entry.key}
      data-card-open={cardOpen ? 'true' : undefined}
      onClick={e => onRowClick(p, e.currentTarget)}
    >
      <td className={styles.tdPid}>{p.pid}</td>
      <td className={styles.tdUser} title={p.user}>{p.user}</td>
      <td className={p.cpu > 50 ? styles.cpuHigh : p.cpu > 20 ? styles.cpuMid : undefined}>{p.cpu.toFixed(1)}</td>
      <td className={p.mem > 50 ? styles.cpuHigh : p.mem > 20 ? styles.cpuMid : undefined}>{p.mem.toFixed(1)}</td>
      <td>{formatRss(p.rssKb)}</td>
      <td className={styles.tdStat} title={p.stat}>{p.stat}</td>
      <td className={styles.tdEtime}>{p.etime}</td>
      <td className={styles.tdCommand} title={p.command}>{p.command}</td>
      <td>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="SIGTERM（优雅停止）"
            disabled={actionPid === p.pid}
            onClick={e => { e.stopPropagation(); void onSignal(p, 'term'); }}
          >
            {actionPid === p.pid ? <FaSpinner size={10} className={styles.spin} /> : <FaStop size={10} />}
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="SIGKILL（强制杀死）"
            disabled={actionPid === p.pid}
            onClick={e => { e.stopPropagation(); void onSignal(p, 'kill'); }}
          >
            <FaSkullCrossbones size={10} />
          </button>
          {p.stat.startsWith('T') ? (
            <button
              type="button"
              className={styles.iconBtn}
              title="SIGCONT（继续）"
              onClick={e => { e.stopPropagation(); void onSignal(p, 'cont'); }}
            >
              <FaPlay size={10} />
            </button>
          ) : (
            <button
              type="button"
              className={styles.iconBtn}
              title="SIGSTOP（暂停）"
              onClick={e => { e.stopPropagation(); void onSignal(p, 'stop'); }}
            >
              <FaStop size={10} className={styles.dimIcon} />
            </button>
          )}
        </div>
      </td>
    </motion.tr>
  );
};

export const ProcessManagerModal: React.FC<ProcessManagerModalProps> = ({ serverId, serverName, onClose }) => {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [sortDesc, setSortDesc] = useState(true);
  const [actionPid, setActionPid] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [detail, setDetail] = useState<{ data: ProcessDetailData; anchor: DOMRect | null } | null>(null);
  const reduced = useReducedMotion();
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchProcesses = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await invoke<ProcessInfo[]>('fetch_processes', { id: serverId });
      setProcesses(result);
    } catch (err) {
      setError(String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void fetchProcesses(); }, [fetchProcesses]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // 安静轮询：窗口隐藏/最小化时暂停（docs/design/principles.md §7）
  usePolling(() => fetchProcesses(true), 3000, autoRefresh);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDesc(prev => !prev);
    } else {
      setSortKey(key);
      setSortDesc(key === 'cpu' || key === 'mem' || key === 'rssKb');
    }
  }, [sortKey]);

  const handleSignal = useCallback(async (proc: ProcessInfo, signal: 'term' | 'kill' | 'stop' | 'cont') => {
    const labels = {
      term: `向进程 ${proc.pid}（${proc.command.slice(0, 40)}）发送 SIGTERM？`,
      kill: `强制杀死进程 ${proc.pid}（${proc.command.slice(0, 40)}）？未保存的数据可能丢失。`,
      stop: `暂停进程 ${proc.pid}（SIGSTOP）？`,
      cont: `恢复进程 ${proc.pid}（SIGCONT）？`,
    };
    const confirmed = await confirm(labels[signal], {
      title: signal === 'kill' ? '强制杀死进程' : '进程操作',
      kind: signal === 'kill' ? 'warning' : 'info',
    });
    if (!confirmed) return;
    setActionPid(proc.pid);
    try {
      await invoke('process_action', { id: serverId, pid: proc.pid, action: signal });
      await fetchProcesses(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setActionPid(null);
    }
  }, [serverId, fetchProcesses]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? processes.filter(p =>
          p.command.toLowerCase().includes(q) ||
          p.user.toLowerCase().includes(q) ||
          String(p.pid).includes(q))
      : processes;
  }, [processes, search]);

  const plainSorted = useMemo(() => {
    const sorted = [...searched].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
    return sorted;
  }, [searched, sortKey, sortDesc]);

  const liveRanking = isLiveRanking(sortKey, sortDesc);
  const rankValue = useCallback(
    (p: ProcessInfo) => (sortKey === 'mem' ? p.mem : p.cpu),
    [sortKey]
  );
  const isClearlyAhead = useMemo(() => isClearlyAheadFor(sortKey), [sortKey]);
  const { ranked, listProps } = useSteadyRanking<ProcessInfo>(
    searched,
    p => String(p.pid),
    rankValue,
    { isClearlyAhead }
  );

  const rows: RankedEntry<ProcessInfo>[] = liveRanking
    ? ranked
    : plainSorted.map((item, index) => ({
        item,
        key: String(item.pid),
        value: rankValue(item),
        level: rankValue(item),
        index,
        prevIndex: index,
        move: 'stay' as const,
        moveSeq: 0,
      }));

  // 行离开列表时收起详情卡
  useEffect(() => {
    if (detail && !rows.some(r => r.key === detail.data.key)) {
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const handleRowClick = useCallback((proc: ProcessInfo, element: HTMLElement | null) => {
    const key = String(proc.pid);
    setDetail(prev => {
      if (prev?.data.key === key) {
        return null;
      }
      return {
        data: {
          key,
          title: proc.command,
          subtitle: `PID ${proc.pid} · ${proc.user}`,
          cpu: Number.isFinite(proc.cpu) ? proc.cpu : null,
          mem: Number.isFinite(proc.mem) ? proc.mem : null,
          rssText: formatRss(proc.rssKb),
          rows: [
            { label: '状态', value: proc.stat },
            { label: '运行时间', value: proc.etime },
            { label: '父进程', value: String(proc.ppid) },
          ],
        },
        anchor: element?.getBoundingClientRect() ?? null,
      };
    });
  }, []);

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <FaSort size={9} className={styles.sortIcon} />;
    return sortDesc
      ? <FaSortDown size={9} className={styles.sortIconActive} />
      : <FaSortUp size={9} className={styles.sortIconActive} />;
  };

  const SortableTh = ({ label, sortId }: { label: string; sortId: SortKey }) => (
    <th className={styles.sortable} onClick={() => handleSort(sortId)}>
      <span className={styles.thInner}>{label}{renderSortIcon(sortId)}</span>
    </th>
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaMicrochip size={14} />
            <span>进程管理</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.autoBtn} ${autoRefresh ? styles.autoBtnOn : ''}`}
              onClick={() => setAutoRefresh(prev => !prev)}
              title={autoRefresh ? '关闭自动刷新' : '开启自动刷新（3 秒）'}
            >
              自动刷新{autoRefresh ? ' · 开' : ' · 关'}
            </button>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchProcesses()} disabled={loading} title="刷新">
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
            placeholder="搜索 PID、用户、命令..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { if (search) { e.stopPropagation(); setSearch(''); } else { onClose(); } } }}
          />
          {search && (
            <button type="button" className={styles.searchClear} onClick={() => setSearch('')}><FaTimes size={9} /></button>
          )}
        </div>

        <div className={styles.content}>
          {loading && processes.length === 0 ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在获取进程列表...</p></div>
          ) : error && processes.length === 0 ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchProcesses()}>重试</button>
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.state}><FaMicrochip size={24} className={styles.emptyIcon} /><p>{search ? '无匹配进程' : '无进程'}</p></div>
          ) : (
            <table className={styles.table} data-card-open={detail ? 'true' : undefined}>
              <thead>
                <tr>
                  <SortableTh label="PID" sortId="pid" />
                  <SortableTh label="用户" sortId="user" />
                  <SortableTh label="CPU%" sortId="cpu" />
                  <SortableTh label="MEM%" sortId="mem" />
                  <SortableTh label="内存" sortId="rssKb" />
                  <th>状态</th>
                  <SortableTh label="运行时间" sortId="etime" />
                  <SortableTh label="命令" sortId="command" />
                  <th>操作</th>
                </tr>
              </thead>
              <tbody {...(liveRanking ? listProps : {})}>
                <AnimatePresence initial={false}>
                  {rows.map(entry => (
                    <ProcessRow
                      key={entry.key}
                      entry={entry}
                      live={liveRanking}
                      reduced={reduced}
                      cardOpen={detail?.data.key === entry.key}
                      actionPid={actionPid}
                      onRowClick={handleRowClick}
                      onSignal={handleSignal}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>

        {error && processes.length > 0 && <div className={styles.errorBar}>{error}</div>}
        <div className={styles.footer}>
          {search ? `匹配 ${rows.length} / ${processes.length} 个进程` : `共 ${processes.length} 个进程`}
        </div>
      </div>

      {detail && (
        <ProcessDetailCard
          data={detail.data}
          anchor={detail.anchor}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};
