import React from "react";
import { MetricBadge, MetricKind } from "./MetricBadge";
import { useAnimatedNumber } from "../../hooks/useAnimatedNumber";
import { formatFigure, UNAVAILABLE } from "../../utils/format";
import styles from "./MetricBadge.module.css";

interface MetricFigureProps {
  kind: MetricKind;
  icon: React.ReactNode;
  /** 份额 0..1，传入则徽章画弧 */
  arc?: number | null;
  /** 数值；null/undefined/NaN 显示 —（绝不显示 0） */
  value: number | null | undefined;
  /** 单位：比数字小一号、弱化显示 */
  unit?: string;
  /** 默认 formatFigure（<10 一位小数，≥10 取整） */
  format?: (v: number) => string;
  /** 悬停说明（名字在 hover 里，界面上不写文字标签） */
  title?: string;
  size?: "md" | "lg";
  className?: string;
}

/**
 * 指标读数：徽章 + 数字 + 弱化单位。
 * 一行内使用同一字号（size="lg" 也只用于同一行的全部成员）。
 */
export const MetricFigure: React.FC<MetricFigureProps> = ({
  kind,
  icon,
  arc,
  value,
  unit,
  format = formatFigure,
  title,
  size = "md",
  className,
}) => {
  const animated = useAnimatedNumber(value ?? null);
  const unavailable = value == null || !Number.isFinite(value);
  const text = unavailable ? UNAVAILABLE : format(animated ?? value!);

  return (
    <span
      className={[styles.figure, size === "lg" ? styles.figureLg : null, className].filter(Boolean).join(" ")}
      title={title}
    >
      <MetricBadge kind={kind} icon={icon} arc={arc} title={title} />
      <span className={unavailable ? ["figure", "figure-unavailable"].join(" ") : "figure"}>{text}</span>
      {unit && !unavailable && <span className="figure-unit">{unit}</span>}
    </span>
  );
};

export default MetricFigure;
