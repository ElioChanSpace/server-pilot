/** 读不到的数值：显示为 em dash，绝不显示 0（0 是有效读数）。 */
export const UNAVAILABLE = "—";

/**
 * 数值排版规则（见 docs/design/principles.md）：
 * 小于 10 显示一位小数，10 及以上取整。
 * `0.4` / `9.9` / `10` / `100`
 */
export function formatFigure(value: number): string {
  if (!Number.isFinite(value)) {
    return UNAVAILABLE;
  }
  const abs = Math.abs(value);
  if (abs < 10) {
    return value.toFixed(1);
  }
  return String(Math.round(value));
}

/** 百分比数值：`formatFigure` 的结果，无百分号（单位由调用方弱化渲染）。 */
export function formatPercentFigure(value: number): string {
  return formatFigure(value);
}

/** 速率（B/s）的小数规则：<100 一位小数，≥100 取整。 */
export function formatRateFigure(value: number): string {
  if (!Number.isFinite(value)) {
    return UNAVAILABLE;
  }
  return Math.abs(value) < 100 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * Format byte counts to human-readable string.
 *
 * 0       -> "0 B"
 * < 1024  -> "XXX B"
 * < 1 MB  -> "X.X KB"
 * < 1 GB  -> "X.X MB"
 * else    -> "X.XX GB"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  if (bytes === 0) {
    return "0 B";
  }

  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (bytes < KB) {
    return `${Math.floor(bytes)} B`;
  }

  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)} KB`;
  }

  if (bytes < GB) {
    return `${(bytes / MB).toFixed(1)} MB`;
  }

  return `${(bytes / GB).toFixed(2)} GB`;
}

/**
 * Format transfer speed in bytes per second to human-readable string.
 *
 * Same thresholds as formatBytes but appends "/s".
 * e.g. "1.2 MB/s", "340 KB/s"
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) {
    return "0 B/s";
  }

  if (bytesPerSecond === 0) {
    return "0 B/s";
  }

  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (bytesPerSecond < KB) {
    return `${Math.floor(bytesPerSecond)} B/s`;
  }

  if (bytesPerSecond < MB) {
    return `${(bytesPerSecond / KB).toFixed(1)} KB/s`;
  }

  if (bytesPerSecond < GB) {
    return `${(bytesPerSecond / MB).toFixed(1)} MB/s`;
  }

  return `${(bytesPerSecond / GB).toFixed(2)} GB/s`;
}

/**
 * Format duration in milliseconds to Chinese human-readable string.
 *
 * < 1000      -> "Xms"
 * < 60000     -> "X秒"
 * < 3600000   -> "X分Y秒"  (skip 0 parts)
 * else        -> "X小时Y分" (skip 0 parts)
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0ms";
  }

  ms = Math.floor(ms);

  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60000) {
    return `${Math.floor(ms / 1000)}秒`;
  }

  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    if (seconds === 0) {
      return `${minutes}分`;
    }

    return `${minutes}分${seconds}秒`;
  }

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);

  if (minutes === 0) {
    return `${hours}小时`;
  }

  return `${hours}小时${minutes}分`;
}
