import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaTimes, FaSpinner, FaExclamationCircle, FaChartLine, FaBolt } from 'react-icons/fa';
import styles from './MetricsHistoryModal.module.css';

interface MetricSample {
  serverId: string;
  timestamp: number;
  cpu: number;
  memPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  diskPercent: number;
  load1: number;
}

interface MetricsSnapshot {
  collectedAt: number;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsage: number;
  load1: number;
  load5: number;
  load15: number;
}

interface MetricsHistoryModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

const RANGES = [
  { id: 3600_000, label: '1 小时' },
  { id: 6 * 3600_000, label: '6 小时' },
  { id: 24 * 3600_000, label: '24 小时' },
  { id: 7 * 24 * 3600_000, label: '7 天' },
];

const SAMPLE_INTERVAL_MS = 10_000;

/** Lightweight SVG line chart (no external chart dependency). */
const LineChart: React.FC<{
  title: string;
  unit: string;
  values: number[];
  timestamps: number[];
  color: string;
  max?: number;
}> = ({ title, unit, values, timestamps, color, max }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 560;
  const H = 140;
  const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

  const stats = useMemo(() => {
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const maxV = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, max: maxV, avg };
  }, [values]);

  if (values.length === 0) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartTitle}>{title}</div>
        <div className={styles.chartEmpty}>暂无数据</div>
      </div>
    );
  }

  const yMax = max ?? Math.max(1, ...values) * 1.15;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.min(v, yMax) / yMax) * innerH;

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const areaPoints = `${PAD.left},${PAD.top + innerH} ${points} ${x(values.length - 1).toFixed(1)},${PAD.top + innerH}`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (px - PAD.left) / innerW;
    const idx = Math.round(ratio * (values.length - 1));
    setHoverIdx(Math.max(0, Math.min(values.length - 1, idx)));
  };

  const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHead}>
        <div className={styles.chartTitle}>{title}</div>
        {stats && (
          <div className={styles.chartStats}>
            <span>低 {stats.min.toFixed(1)}{unit}</span>
            <span>均 {stats.avg.toFixed(1)}{unit}</span>
            <span>高 {stats.max.toFixed(1)}{unit}</span>
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chartSvg}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {gridLines.map(g => (
          <g key={g}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={PAD.top + innerH * g} y2={PAD.top + innerH * g}
              className={styles.gridLine}
            />
            <text x={PAD.left - 6} y={PAD.top + innerH * g + 3} className={styles.axisText} textAnchor="end">
              {(yMax * (1 - g)).toFixed(0)}
            </text>
          </g>
        ))}
        <polygon points={areaPoints} fill={color} opacity={0.12} />
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
        {hoverIdx !== null && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.top} y2={PAD.top + innerH} className={styles.hoverLine} />
            <circle cx={x(hoverIdx)} cy={y(values[hoverIdx])} r={3.5} fill={color} />
          </g>
        )}
      </svg>
      {hoverIdx !== null && (
        <div className={styles.tooltip}>
          {fmtTime(timestamps[hoverIdx])} · {values[hoverIdx].toFixed(1)}{unit}
        </div>
      )}
    </div>
  );
};

export const MetricsHistoryModal: React.FC<MetricsHistoryModalProps> = ({ serverId, serverName, onClose }) => {
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [range, setRange] = useState(RANGES[2].id);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const since = Date.now() - range;
      const rows = await invoke<MetricSample[]>('get_metric_history', {
        serverId,
        sinceMs: since,
      });
      setSamples(rows);
    } catch (err) {
      setError(String(err));
    }
  }, [serverId, range]);

  const sampleNow = useCallback(async () => {
    try {
      const snap = await invoke<MetricsSnapshot>('fetch_server_metrics', { id: serverId });
      const sample: MetricSample = {
        serverId,
        timestamp: Date.now(),
        cpu: snap.cpuUsage,
        memPercent: snap.memoryUsage,
        memUsedMb: snap.memoryUsedMb,
        memTotalMb: snap.memoryTotalMb,
        diskPercent: snap.diskUsage,
        load1: snap.load1,
      };
      await invoke('add_metric_samples', { samples: [sample] });
      setSamples(prev => {
        const next = [...prev.filter(s => s.timestamp !== sample.timestamp), sample];
        next.sort((a, b) => a.timestamp - b.timestamp);
        return next;
      });
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [serverId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void (async () => {
      await loadHistory();
      await sampleNow();
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [loadHistory, sampleNow]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { void sampleNow(); }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, sampleNow]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const visible = useMemo(
    () => samples.filter(s => s.timestamp >= Date.now() - range),
    [samples, range],
  );

  const cpu = visible.map(s => s.cpu);
  const mem = visible.map(s => s.memPercent);
  const disk = visible.map(s => s.diskPercent);
  const load = visible.map(s => s.load1);
  const ts = visible.map(s => s.timestamp);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaChartLine size={14} />
            <span>资源历史</span>
            <span className={styles.serverName}>{serverName}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.liveBtn} ${live ? styles.liveBtnOn : ''}`}
              onClick={() => setLive(prev => !prev)}
              title={live ? '暂停采样' : '恢复采样（10 秒）'}
            >
              <FaBolt size={10} /> {live ? '采样中' : '已暂停'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}><FaTimes size={13} /></button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.chips}>
            {RANGES.map(r => (
              <button
                key={r.id}
                type="button"
                className={`${styles.chip} ${range === r.id ? styles.chipActive : ''}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className={styles.sampleInfo}>打开期间每 10 秒采样，数据本地留存 30 天</div>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.state}><FaSpinner size={24} className={styles.spin} /><p>正在加载历史数据...</p></div>
          ) : error && visible.length === 0 ? (
            <div className={styles.state}>
              <FaExclamationCircle size={24} className={styles.errorIcon} />
              <p className={styles.errorText}>{error}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.state}><FaChartLine size={24} className={styles.emptyIcon} /><p>暂无历史数据，保持打开即可开始积累</p></div>
          ) : (
            <>
              <LineChart title="CPU 使用率" unit="%" values={cpu} timestamps={ts} color="var(--accent-color)" max={100} />
              <LineChart title="内存使用率" unit="%" values={mem} timestamps={ts} color="#67c23a" max={100} />
              <div className={styles.chartRow}>
                <LineChart title="磁盘使用率" unit="%" values={disk} timestamps={ts} color="#e6a23c" max={100} />
                <LineChart title="负载 (1 分钟)" unit="" values={load} timestamps={ts} color="#f56c6c" />
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {visible.length} 个采样点{error ? <span className={styles.footerError}> · {error}</span> : null}
        </div>
      </div>
    </div>
  );
};
