import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaTimes, FaSpinner, FaExclamationCircle, FaClock, FaSearch, FaSyncAlt } from 'react-icons/fa';
import styles from './ScheduledTasksModal.module.css';

interface CronJob {
  source: string;
  schedule: string;
  user: string;
  command: string;
}

interface SystemdTimer {
  unit: string;
  activates: string;
  next: string;
  left: string;
}

interface ScheduledTasksModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export const ScheduledTasksModal: React.FC<ScheduledTasksModalProps> = ({ serverId, serverName, onClose }) => {
  const [tab, setTab] = useState<'cron' | 'timers'>('cron');
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [timers, setTimers] = useState<SystemdTimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cron, tmr] = await Promise.all([
        invoke<CronJob[]>('fetch_cron_jobs', { id: serverId }),
        invoke<SystemdTimer[]>('fetch_systemd_timers', { id: serverId }),
      ]);
      setCronJobs(cron);
      setTimers(tmr);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const filteredCron = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cronJobs;
    return cronJobs.filter(j =>
      j.command.toLowerCase().includes(q) ||
      j.schedule.toLowerCase().includes(q) ||
      j.source.toLowerCase().includes(q) ||
      j.user.toLowerCase().includes(q));
  }, [cronJobs, search]);

  const filteredTimers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return timers;
    return timers.filter(t =>
      t.unit.toLowerCase().includes(q) ||
      t.activates.toLowerCase().includes(q) ||
      t.next.toLowerCase().includes(q));
  }, [timers, search]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaClock size={14} />
            <span>定时任务</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchAll()} disabled={loading} title="刷新">
              {loading ? <FaSpinner size={12} className={styles.spin} /> : '刷新'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${tab === 'cron' ? styles.chipActive : ''}`}
              onClick={() => setTab('cron')}
            >
              Cron 任务{!loading && <span className={styles.count}>{cronJobs.length}</span>}
            </button>
            <button
              type="button"
              className={`${styles.chip} ${tab === 'timers' ? styles.chipActive : ''}`}
              onClick={() => setTab('timers')}
            >
              Systemd Timers{!loading && <span className={styles.count}>{timers.length}</span>}
            </button>
          </div>
          <div className={styles.searchBar}>
            <FaSearch size={11} className={styles.searchIcon} />
            <input
              ref={searchRef}
              className={styles.searchInput}
              placeholder="搜索任务、命令、单元..."
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
          {loading ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在读取定时任务...</p></div>
          ) : error ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchAll()}>重试</button>
            </div>
          ) : tab === 'cron' ? (
            filteredCron.length === 0 ? (
              <div className={styles.state}><FaClock size={24} className={styles.emptyIcon} /><p>{search ? '无匹配任务' : '无 Cron 任务'}</p></div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>执行计划</th>
                    <th>命令</th>
                    <th>用户</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCron.map((j, i) => (
                    <tr key={`${j.source}-${i}`}>
                      <td className={styles.tdSchedule}>{j.schedule}</td>
                      <td className={styles.tdCommand} title={j.command}>{j.command}</td>
                      <td className={styles.tdUser}>{j.user}</td>
                      <td className={styles.tdSource} title={j.source}>{j.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : filteredTimers.length === 0 ? (
            <div className={styles.state}><FaSyncAlt size={24} className={styles.emptyIcon} /><p>{search ? '无匹配 Timer' : '无 Systemd Timer'}</p></div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Timer 单元</th>
                  <th>激活单元</th>
                  <th>下次触发</th>
                  <th>剩余</th>
                </tr>
              </thead>
              <tbody>
                {filteredTimers.map(t => (
                  <tr key={t.unit}>
                    <td className={styles.tdUnit}>{t.unit}</td>
                    <td className={styles.tdSource} title={t.activates}>{t.activates}</td>
                    <td className={styles.tdSchedule}>{t.next}</td>
                    <td className={styles.tdUser}>{t.left}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.footer}>
          {tab === 'cron'
            ? `Cron 任务 ${filteredCron.length}${search ? ` / ${cronJobs.length}` : ''} 条（用户/root crontab、/etc/crontab、/etc/cron.d）`
            : `Systemd Timers ${filteredTimers.length}${search ? ` / ${timers.length}` : ''} 个`}
        </div>
      </div>
    </div>
  );
};
