import React from "react";
import styles from "./MetricBadge.module.css";

/** 指标归属：颜色即语义（docs/design/principles.md）。 */
export type MetricKind = "cpu" | "mem" | "disk" | "net" | "gpu" | "load" | "neutral";

export const METRIC_COLOR_VAR: Record<MetricKind, string> = {
  cpu: "var(--metric-cpu)",
  mem: "var(--metric-mem)",
  disk: "var(--metric-disk)",
  net: "var(--metric-net)",
  gpu: "var(--metric-gpu)",
  load: "var(--metric-load)",
  neutral: "var(--text-secondary)",
};

interface MetricBadgeProps {
  kind: MetricKind;
  icon: React.ReactNode;
  /** 份额 0..1。有值时画弧（弧长即数值）；null/undefined 为纯圆盘。 */
  arc?: number | null;
  size?: number;
  title?: string;
  className?: string;
}

/**
 * 指标徽章：固定尺寸圆盘 + 图标，是"份额"的数值外圈加弧。
 * 徽章尺寸在任何布局中保持不变（--badge-size）。
 */
export const MetricBadge: React.FC<MetricBadgeProps> = ({
  kind,
  icon,
  arc,
  size,
  title,
  className,
}) => {
  const color = METRIC_COLOR_VAR[kind];
  const px = size ?? 20;
  const ring = 2;
  const r = (px - ring) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = arc == null || !Number.isFinite(arc) ? 0 : Math.min(1, Math.max(0, arc));
  const hasArc = arc != null && Number.isFinite(arc);

  return (
    <span
      className={[styles.badge, className].filter(Boolean).join(" ")}
      style={{ width: px, height: px, ["--badge-color" as string]: color }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      <span className={styles.disc} />
      {hasArc && (
        <svg className={styles.ring} width={px} height={px} viewBox={`0 0 ${px} ${px}`}>
          <circle
            className={styles.track}
            cx={px / 2}
            cy={px / 2}
            r={r}
            strokeWidth={ring}
          />
          <circle
            className={styles.arc}
            cx={px / 2}
            cy={px / 2}
            r={r}
            strokeWidth={ring}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped)}
            transform={`rotate(-90 ${px / 2} ${px / 2})`}
          />
        </svg>
      )}
      <span className={styles.glyph}>{icon}</span>
    </span>
  );
};

export default MetricBadge;
