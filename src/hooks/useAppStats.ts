import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppStats } from "../types/app";

const POLL_INTERVAL_MS = 5000;

export function useAppStats(): AppStats {
  const [stats, setStats] = useState<AppStats>({ memoryMb: 0, cpuPercent: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchStats = () => {
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
    };

    // Fetch immediately on mount
    fetchStats();

    intervalRef.current = setInterval(fetchStats, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return stats;
}
