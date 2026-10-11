import { useEffect, useState } from "react";
import type { AppTheme } from "../types/theme";
import { getPublishedTheme, subscribeTheme } from "../utils/theme-store";

export type MetricColorKey = "cpu" | "mem" | "disk" | "net" | "gpu" | "load";

/**
 * 指标语义色映射（与 App.css 的 --metric-* 定义一致）：
 * CPU=accent、内存=info、磁盘=warning、网络=success、GPU=debug、负载=danger。
 */
const colorsFromTheme = (theme: AppTheme): Record<MetricColorKey, string> => ({
  cpu: theme.colors.accent,
  mem: theme.colors.info,
  disk: theme.colors.warning,
  net: theme.colors.success,
  gpu: theme.colors.debug,
  load: theme.colors.danger,
});

const FALLBACK: Record<MetricColorKey, string> = {
  cpu: "#888",
  mem: "#888",
  disk: "#888",
  net: "#888",
  gpu: "#888",
  load: "#888",
};

/**
 * 指标语义色：直接来自当前主题对象（订阅 theme-store），
 * 不经 DOM 自定义属性，切换主题立即生效。供图表等需要具体色值的场景使用。
 */
export function useMetricColors(): Record<MetricColorKey, string> {
  const [colors, setColors] = useState<Record<MetricColorKey, string>>(
    () => (getPublishedTheme() ? colorsFromTheme(getPublishedTheme()!) : FALLBACK)
  );

  useEffect(
    () =>
      subscribeTheme(theme => {
        setColors(colorsFromTheme(theme));
      }),
    []
  );

  return colors;
}
