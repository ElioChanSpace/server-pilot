import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { FaHdd, FaMemory, FaMicrochip, FaTachometerAlt, FaWaveSquare } from "react-icons/fa";
import { OsType, Server } from "../context/ServerContext";
import { useMetricColors } from "../hooks/useMetricColors";
import { usePolling } from "../hooks/usePolling";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useSteadyRanking, RankedEntry } from "../hooks/useSteadyRanking";
import { formatFigure, UNAVAILABLE } from "../utils/format";
import MetricFigure from "./metrics/MetricFigure";
import ProcessDetailCard, { ProcessDetailData } from "./metrics/ProcessDetailCard";
import styles from "./ServerMonitoringPanel.module.css";

interface ProcessMetric {
  pid: number;
  cpuUsage: number;
  memoryUsage: number;
  command: string;
}

interface GpuMetric {
  name: string;
  usage: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryUsage: number;
}

interface ServerMetricsSnapshot {
  collectedAt: number;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsage: number;
  load1: number;
  load5: number;
  load15: number;
  gpu: GpuMetric | null;
  gpuStatus: string;
  topProcesses: ProcessMetric[];
}

interface ChartPoint {
  time: string;
  cpu: number;
  gpu: number | null;
  disk: number | null;
}

interface ServerMonitoringPanelProps {
  server: Server;
}

const POLL_INTERVAL_MS = 10000;
const MAX_HISTORY_SIZE = 18;

const formatPercent = (value: number) => `${formatFigure(value)}%`;

const formatMemory = (usedMb: number, totalMb: number) => {
  const usedGb = usedMb / 1024;
  const totalGb = totalMb / 1024;
  return `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`;
};

const formatProcessMemory = (value: number) => `${formatFigure(value)}%`;

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const TooltipContent = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string }>;
  label?: string;
}) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
        {payload.map(item => (
          <div key={item.name} className={styles.tooltipRow}>
            <span style={{ color: item.color }}>{item.name}</span>
            <strong>{item.value == null ? UNAVAILABLE : formatPercent(item.value)}</strong>
          </div>
        ))}
    </div>
  );
};

const ServerMonitoringPanelComponent: React.FC<ServerMonitoringPanelProps> = ({ server }) => {
  const [samples, setSamples] = React.useState<ServerMetricsSnapshot[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [procDetail, setProcDetail] = React.useState<{ data: ProcessDetailData; anchor: DOMRect | null } | null>(null);
  const reduced = useReducedMotion();
  const hasLoadedRef = React.useRef(false);

  const canMonitor = server.osType === OsType.Linux && server.status !== "disconnected";

  React.useEffect(() => {
    setSamples([]);
    setError(null);
    setIsLoading(false);
    hasLoadedRef.current = false;
  }, [server.id]);

  const activeServerRef = React.useRef(server.id);
  activeServerRef.current = server.id;

  React.useEffect(() => {
    if (!canMonitor) {
      setSamples([]);
      setError(null);
      setIsLoading(false);
      hasLoadedRef.current = false;
    }
  }, [canMonitor, server.id]);

  const fetchMetrics = React.useCallback(async () => {
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }
    try {
      const snapshot = await invoke<ServerMetricsSnapshot>("fetch_server_metrics", { id: server.id });
      if (activeServerRef.current !== server.id) {
        return;
      }
      setSamples(prev => [...prev, snapshot].slice(-MAX_HISTORY_SIZE));
      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      if (activeServerRef.current === server.id) {
        setError(typeof err === "string" ? err : "采集服务器状态失败");
      }
    } finally {
      if (activeServerRef.current === server.id) {
        setIsLoading(false);
      }
    }
  }, [server.id]);

  // 安静轮询：窗口隐藏/最小化时暂停（docs/design/principles.md §7）
  usePolling(fetchMetrics, POLL_INTERVAL_MS, canMonitor);

  // 挂载/切换服务器时先采一次
  React.useEffect(() => {
    if (canMonitor) {
      void fetchMetrics();
    }
  }, [fetchMetrics, canMonitor]);

  const latestSample = samples[samples.length - 1] ?? null;
  const metricColors = useMetricColors();
  const topProcesses = latestSample?.topProcesses ?? [];
  const { ranked: rankedProcesses, listProps: processListProps } = useSteadyRanking<ProcessMetric>(
    topProcesses,
    p => `${p.pid}-${p.command}`,
    p => p.cpuUsage
  );

  // 行离开列表时收起详情卡
  React.useEffect(() => {
    if (procDetail && !rankedProcesses.some(entry => entry.key === procDetail.data.key)) {
      setProcDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedProcesses]);

  const handleProcessClick = React.useCallback((entry: RankedEntry<ProcessMetric>, element: HTMLElement | null) => {
    const p = entry.item;
    setProcDetail(prev => {
      if (prev?.data.key === entry.key) {
        return null;
      }
      return {
        data: {
          key: entry.key,
          title: p.command,
          subtitle: `PID ${p.pid}`,
          cpu: Number.isFinite(p.cpuUsage) ? p.cpuUsage : null,
          mem: Number.isFinite(p.memoryUsage) ? p.memoryUsage : null,
        },
        anchor: element?.getBoundingClientRect() ?? null,
      };
    });
  }, []);
  const chartData = React.useMemo<ChartPoint[]>(
    () =>
      samples.map(sample => ({
        time: formatTime(sample.collectedAt),
        cpu: sample.cpuUsage,
        gpu: sample.gpu?.usage ?? null,
        disk: sample.diskUsage ?? null,
      })),
    [samples]
  );

  if (server.osType !== OsType.Linux) {
    return (
      <div className={styles.section}>
        <div className={styles.header}>
          <h3>服务器状态</h3>
          <span>暂不支持</span>
        </div>
        <div className={styles.emptyState}>当前仅支持 Linux 服务器的性能采样。</div>
      </div>
    );
  }

  if (server.status === "disconnected") {
    return (
      <div className={styles.section}>
        <div className={styles.header}>
          <h3>服务器状态</h3>
          <span>待连接</span>
        </div>
        <div className={styles.emptyState}>连接服务器后会在这里显示 CPU、GPU 与进程占用情况。</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3>服务器状态</h3>
        <span>{latestSample ? `最近更新 ${formatTime(latestSample.collectedAt)}` : "正在采样"}</span>
      </div>

      <div className={styles.metricGrid}>
        <MetricFigure
          kind="cpu"
          icon={<FaMicrochip />}
          arc={latestSample ? latestSample.cpuUsage / 100 : null}
          value={latestSample ? latestSample.cpuUsage : null}
          unit="%"
          title="CPU 占用"
        />
        <MetricFigure
          kind="mem"
          icon={<FaMemory />}
          arc={latestSample ? latestSample.memoryUsage / 100 : null}
          value={latestSample ? latestSample.memoryUsage : null}
          unit="%"
          title="内存占用"
        />
        <MetricFigure
          kind="disk"
          icon={<FaHdd />}
          arc={latestSample ? latestSample.diskUsage / 100 : null}
          value={latestSample ? latestSample.diskUsage : null}
          unit="%"
          title="磁盘占用"
        />
        <MetricFigure
          kind="gpu"
          icon={<FaTachometerAlt />}
          arc={latestSample?.gpu ? latestSample.gpu.usage / 100 : null}
          value={latestSample?.gpu ? latestSample.gpu.usage : null}
          unit="%"
          title="GPU 占用"
        />
        <MetricFigure
          kind="load"
          icon={<FaWaveSquare />}
          value={latestSample ? latestSample.load1 : null}
          format={value => value.toFixed(2)}
          title="1 分钟负载"
        />
      </div>

      {latestSample && (
        <div className={styles.memoryRow}>
          <div
            className={styles.memoryTrack}
            role="img"
            aria-label={`内存占用 ${formatPercent(latestSample.memoryUsage)}`}
          >
            <div
              className={styles.memoryFill}
              style={{ width: `${Math.min(100, Math.max(0, latestSample.memoryUsage))}%` }}
            />
          </div>
          <div className={styles.memoryMeta}>
            <span className="figure">{formatMemory(latestSample.memoryUsedMb, latestSample.memoryTotalMb)}</span>
            <span className={styles.memorySecondary}>
              负载 {latestSample.load5.toFixed(2)} / {latestSample.load15.toFixed(2)}
            </span>
            <span className={styles.memorySecondary}>
              {latestSample.gpu
                ? `${latestSample.gpu.name} · ${formatMemory(latestSample.gpu.memoryUsedMb, latestSample.gpu.memoryTotalMb)}`
                : latestSample.gpuStatus === "idle"
                  ? "GPU 未返回使用率"
                  : "未检测到 GPU"}
            </span>
          </div>
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.chartCard}>
        <div className={styles.cardHeader}>
          <h4>占用趋势</h4>
          <span>每 10 秒刷新</span>
        </div>
        <div className={styles.chartContainer}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={metricColors.cpu} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={metricColors.cpu} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={metricColors.gpu} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={metricColors.gpu} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="diskGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={metricColors.disk} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={metricColors.disk} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(127, 127, 127, 0.14)" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={20} />
                <Tooltip content={<TooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  name="CPU"
                  stroke={metricColors.cpu}
                  fill="url(#cpuGradient)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="gpu"
                  name="GPU"
                  stroke={metricColors.gpu}
                  fill="url(#gpuGradient)"
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="disk"
                  name="磁盘"
                  stroke={metricColors.disk}
                  fill="url(#diskGradient)"
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className={styles.chartPlaceholder}>{isLoading ? "正在拉取首个样本..." : "暂无可展示的趋势数据"}</div>
          )}
        </div>
      </div>

      <div className={styles.processCard}>
        <div className={styles.cardHeader}>
          <h4>进程占用排名</h4>
          <span>按 CPU 排序</span>
        </div>
        {rankedProcesses.length ? (
          <div className={styles.tableWrap} {...processListProps}>
            <table className={styles.processTable} data-card-open={procDetail ? "true" : undefined}>
              <thead>
                <tr>
                  <th>进程</th>
                  <th>进程 ID</th>
                  <th>CPU</th>
                  <th>内存</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rankedProcesses.map(entry => (
                    <TopProcessRow
                      key={entry.key}
                      entry={entry}
                      reduced={reduced}
                      cardOpen={procDetail?.data.key === entry.key}
                      onClick={handleProcessClick}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>还没有进程数据，通常在首个样本返回后显示。</div>
        )}
      </div>

      {procDetail && (
        <ProcessDetailCard
          data={procDetail.data}
          anchor={procDetail.anchor}
          onClose={() => setProcDetail(null)}
        />
      )}
    </div>
  );
};

interface TopProcessRowProps {
  entry: RankedEntry<ProcessMetric>;
  reduced: boolean;
  cardOpen: boolean;
  onClick: (entry: RankedEntry<ProcessMetric>, element: HTMLElement | null) => void;
}

const TopProcessRow: React.FC<TopProcessRowProps> = ({ entry, reduced, cardOpen, onClick }) => {
  const p = entry.item;
  const controls = useAnimationControls();

  React.useEffect(() => {
    if (reduced || entry.move !== "turnover") {
      return;
    }
    void controls.start({
      opacity: [0, 1],
      y: [6, 0],
      transition: { duration: 0.22, ease: "easeOut" },
    });
  }, [entry.moveSeq, entry.move, reduced, controls]);

  const isEntering = !reduced && entry.move === "enter";

  return (
    <motion.tr
      layout={!reduced && entry.move === "slide"}
      transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.6 }}
      initial={isEntering ? { opacity: 0 } : false}
      animate={isEntering ? { opacity: 1, transition: { duration: 0.22, ease: "easeOut" } } : undefined}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      whileTap={{ scale: 0.985 }}
      data-process-row={entry.key}
      data-card-open={cardOpen ? "true" : undefined}
      onClick={e => onClick(entry, e.currentTarget)}
    >
      <td>{p.command}</td>
      <td>{p.pid}</td>
      <td>{formatPercent(p.cpuUsage)}</td>
      <td>{formatProcessMemory(p.memoryUsage)}</td>
    </motion.tr>
  );
};

const ServerMonitoringPanel = React.memo(ServerMonitoringPanelComponent);

export default ServerMonitoringPanel;
