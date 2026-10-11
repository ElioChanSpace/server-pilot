import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppStats } from "../types/app";
import { usePolling } from "./usePolling";

const POLL_INTERVAL_MS = 5000;

export function useAppStats(): AppStats {
  const [stats, setStats] = useState<AppStats>({ memoryMb: 0, cpuPercent: 0 });

  const fetchStats = useCallback(() => {
    invoke<AppStats>("get_app_stats")
      .then(next => {
        // Skip state updates (and the App re-render) when nothing changed.
        setStats(prev =>
          prev.memoryMb === next.memoryMb && prev.cpuPercent === next.cpuPercent ? prev : next,
        );
      })
      .catch((err) => {
        console.error("Failed to fetch app stats:", err);
      });
  }, []);

  // 挂载时先采一次
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // 安静轮询：窗口隐藏/最小化时暂停（docs/design/principles.md §7）
  usePolling(fetchStats, POLL_INTERVAL_MS);

  return stats;
}
