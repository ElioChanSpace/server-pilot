import { useEffect, useState } from "react";

export type MetricColorKey = "cpu" | "mem" | "disk" | "net" | "gpu" | "load";

const KEYS: MetricColorKey[] = ["cpu", "mem", "disk", "net", "gpu", "load"];

const readColors = (): Record<MetricColorKey, string> => {
  const style = getComputedStyle(document.documentElement);
  const out = {} as Record<MetricColorKey, string>;
  for (const key of KEYS) {
    out[key] = style.getPropertyValue(`--metric-${key}`).trim() || "#888";
  }
  return out;
};

/**
 * 读取指标语义色（--metric-*）。主题切换（含跟随系统）时自动刷新，
 * 供图表等需要具体色值的场景使用。
 */
export function useMetricColors(): Record<MetricColorKey, string> {
  const [colors, setColors] = useState<Record<MetricColorKey, string>>(readColors);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme", "data-theme-id"],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}
