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
