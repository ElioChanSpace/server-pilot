import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FaTimes, FaSpinner, FaExclamationCircle, FaServer, FaLinux, FaMicrochip,
  FaMemory, FaClock, FaSyncAlt,
} from 'react-icons/fa';
import styles from './SystemInfoModal.module.css';

interface SystemInfo {
  hostname: string;
  kernel: string;
  arch: string;
  distro: string;
  cpuModel: string;
  cpuCores: number;
  load1: number;
  load5: number;
  load15: number;
  procsRunning: number;
  uptimeSeconds: number;
  memTotalKb: number;
  memUsedKb: number;
  memAvailKb: number;
  swapTotalKb: number;
  swapUsedKb: number;
}

interface SystemInfoModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

const formatBytes = (kb: number) => {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
};

const formatUptime = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
};

const loadTone = (load: number, cores: number) => {
  if (cores <= 0) return '';
  const ratio = load / cores;
  return ratio >= 1 ? styles.toneHigh : ratio >= 0.7 ? styles.toneMid : styles.toneOk;
};

export const SystemInfoModal: React.FC<SystemInfoModalProps> = ({ serverId, serverName, onClose }) => {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SystemInfo>('fetch_system_info', { id: serverId });
      setInfo(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { void fetchInfo(); }, [fetchInfo]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const memPct = info && info.memTotalKb > 0 ? Math.round((info.memUsedKb / info.memTotalKb) * 100) : 0;
  const swapPct = info && info.swapTotalKb > 0 ? Math.round((info.swapUsedKb / info.swapTotalKb) * 100) : 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaServer size={14} />
            <span>系统信息</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshBtn} onClick={() => void fetchInfo()} disabled={loading} title="刷新">
              {loading ? <FaSpinner size={12} className={styles.spin} /> : '刷新'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.content}>
          {loading && !info ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在采集系统信息...</p></div>
          ) : error && !info ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void fetchInfo()}>重试</button>
            </div>
          ) : info ? (
            <>
              <div className={styles.heroCard}>
                <div className={styles.heroLeft}>
                  <div className={styles.hostname}>{info.hostname || '—'}</div>
                  <div className={styles.distro}><FaLinux size={12} /> {info.distro || info.kernel || '—'}</div>
                </div>
                <div className={styles.heroRight}>
                  <div className={styles.heroStat}>
                    <span className={styles.heroLabel}>运行时间</span>
                    <span className={styles.heroValue}><FaClock size={11} /> {formatUptime(info.uptimeSeconds)}</span>
                  </div>
                  <div className={styles.heroStat}>
                    <span className={styles.heroLabel}>运行中进程</span>
                    <span className={styles.heroValue}>{info.procsRunning}</span>
                  </div>
                </div>
              </div>

              <div className={styles.grid}>
                <div className={styles.tile}>
                  <div className={styles.tileLabel}><FaLinux size={11} /> 内核</div>
                  <div className={styles.tileValue} title={info.kernel}>{info.kernel || '—'}</div>
                </div>
                <div className={styles.tile}>
                  <div className={styles.tileLabel}><FaServer size={11} /> 架构</div>
                  <div className={styles.tileValue}>{info.arch || '—'}</div>
                </div>
                <div className={styles.tileWide}>
                  <div className={styles.tileLabel}><FaMicrochip size={11} /> CPU</div>
                  <div className={styles.tileValue} title={info.cpuModel}>{info.cpuModel || '—'}</div>
                  <div className={styles.tileSub}>{info.cpuCores} 核</div>
                </div>
                <div className={styles.tile}>
                  <div className={styles.tileLabel}><FaSyncAlt size={11} /> 负载</div>
                  <div className={styles.tileValue}>
                    <span className={loadTone(info.load1, info.cpuCores)}>{info.load1.toFixed(2)}</span>
                    <span className={styles.loadSub}> / {info.load5.toFixed(2)} / {info.load15.toFixed(2)}</span>
                  </div>
                  <div className={styles.tileSub}>1 / 5 / 15 分钟</div>
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}><FaMemory size={12} /> 内存</div>
                <div className={styles.barHeader}>
                  <span>{formatBytes(info.memUsedKb)} / {formatBytes(info.memTotalKb)}</span>
                  <span className={memPct >= 90 ? styles.toneHigh : memPct >= 70 ? styles.toneMid : styles.toneOk}>{memPct}%</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={`${styles.barFill} ${memPct >= 90 ? styles.barDanger : memPct >= 70 ? styles.barWarn : styles.barOk}`}
                    style={{ width: `${Math.min(100, memPct)}%` }}
                  />
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}><FaMemory size={12} /> Swap</div>
                {info.swapTotalKb === 0 ? (
                  <div className={styles.noSwap}>未配置 Swap</div>
                ) : (
                  <>
                    <div className={styles.barHeader}>
                      <span>{formatBytes(info.swapUsedKb)} / {formatBytes(info.swapTotalKb)}</span>
                      <span className={swapPct >= 90 ? styles.toneHigh : swapPct >= 70 ? styles.toneMid : styles.toneOk}>{swapPct}%</span>
                    </div>
                    <div className={styles.barTrack}>
                      <div
                        className={`${styles.barFill} ${swapPct >= 90 ? styles.barDanger : swapPct >= 70 ? styles.barWarn : styles.barOk}`}
                        style={{ width: `${Math.min(100, swapPct)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className={styles.footNote}>可用内存 {formatBytes(info.memAvailKb)}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
