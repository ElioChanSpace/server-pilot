import React from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { OsType, Server } from "../context/ServerContext";
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
  gpu: GpuMetric | null;
  gpuStatus: string;
  topProcesses: ProcessMetric[];
}

interface ChartPoint {
  time: string;
  cpu: number;
  gpu: number | null;
}

interface ServerMonitoringPanelProps {
  server: Server;
}

const POLL_INTERVAL_MS = 10000;
const MAX_HISTORY_SIZE = 18;

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const formatMemory = (usedMb: number, totalMb: number) => {
  const usedGb = usedMb / 1024;
  const totalGb = totalMb / 1024;
  return `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`;
};

const formatProcessMemory = (value: number) => `${value.toFixed(1)}%`;

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
          <strong>{item.value == null ? "--" : formatPercent(item.value)}</strong>
        </div>
      ))}
    </div>
  );
};

const ServerMonitoringPanel: React.FC<ServerMonitoringPanelProps> = ({ server }) => {
  const [samples, setSamples] = React.useState<ServerMetricsSnapshot[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const hasLoadedRef = React.useRef(false);

  const canMonitor = server.osType === OsType.Linux && server.status !== "disconnected";

  React.useEffect(() => {
    setSamples([]);
    setError(null);
    setIsLoading(false);
    hasLoadedRef.current = false;
  }, [server.id]);

  React.useEffect(() => {
    if (!canMonitor) {
      setSamples([]);
      setError(null);
      setIsLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    let disposed = false;

    const fetchMetrics = async () => {
      if (disposed) {
        return;
      }

      if (!hasLoadedRef.current) {
        setIsLoading(true);
      }

      try {
        const snapshot = await invoke<ServerMetricsSnapshot>("fetch_server_metrics", { id: server.id });
        if (disposed) {
          return;
        }

        setSamples(prev => {
          const next = [...prev, snapshot];
          return next.slice(-MAX_HISTORY_SIZE);
        });
        setError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        if (!disposed) {
          setError(typeof err === "string" ? err : "采集服务器状态失败");
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    };

    void fetchMetrics();
    const timer = window.setInterval(() => {
      void fetchMetrics();
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [canMonitor, server.id]);

  const latestSample = samples[samples.length - 1] ?? null;
  const chartData = React.useMemo<ChartPoint[]>(
    () =>
      samples.map(sample => ({
        time: formatTime(sample.collectedAt),
        cpu: sample.cpuUsage,
        gpu: sample.gpu?.usage ?? null,
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

      <div className={styles.tableCard}>
        <table className={styles.infoTable}>
          <tbody>
            <tr>
              <th>CPU 占用</th>
              <td>{latestSample ? formatPercent(latestSample.cpuUsage) : "--"}</td>
            </tr>
            <tr>
              <th>内存占用</th>
              <td>{latestSample ? formatPercent(latestSample.memoryUsage) : "--"}</td>
            </tr>
            <tr>
              <th>内存使用</th>
              <td>{latestSample ? formatMemory(latestSample.memoryUsedMb, latestSample.memoryTotalMb) : "等待首个样本"}</td>
            </tr>
            <tr>
              <th>GPU 占用</th>
              <td>{latestSample?.gpu ? formatPercent(latestSample.gpu.usage) : latestSample ? "不适用" : "--"}</td>
            </tr>
            <tr>
              <th>GPU 信息</th>
              <td>
                {latestSample?.gpu
                  ? `${latestSample.gpu.name} · ${formatMemory(
                      latestSample.gpu.memoryUsedMb,
                      latestSample.gpu.memoryTotalMb
                    )}`
                  : latestSample?.gpuStatus === "idle"
                    ? "已检测到 GPU，但当前未返回使用率"
                    : "未检测到可用 GPU"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
                    <stop offset="5%" stopColor="#4f8cff" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#4f8cff" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7bda7b" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#7bda7b" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(127, 127, 127, 0.14)" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={20} />
                <Tooltip content={<TooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  name="CPU"
                  stroke="#4f8cff"
                  fill="url(#cpuGradient)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="gpu"
                  name="GPU"
                  stroke="#7bda7b"
                  fill="url(#gpuGradient)"
                  strokeWidth={2}
                  connectNulls
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
        {latestSample?.topProcesses?.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.processTable}>
              <thead>
                <tr>
                  <th>进程</th>
                  <th>进程 ID</th>
                  <th>CPU</th>
                  <th>内存</th>
                </tr>
              </thead>
              <tbody>
                {latestSample.topProcesses.map((process, index) => (
                  <tr key={`${process.pid}-${process.command}-${index}`}>
                    <td>{process.command}</td>
                    <td>{process.pid}</td>
                    <td>{formatPercent(process.cpuUsage)}</td>
                    <td>{formatProcessMemory(process.memoryUsage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>还没有进程数据，通常在首个样本返回后显示。</div>
        )}
      </div>
    </div>
  );
};

export default ServerMonitoringPanel;
