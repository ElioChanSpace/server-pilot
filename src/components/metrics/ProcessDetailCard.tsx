import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { FaMemory, FaMicrochip } from "react-icons/fa";
import MetricFigure from "./MetricFigure";
import { formatBytes, formatFigure, UNAVAILABLE } from "../../utils/format";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import styles from "./ProcessDetailCard.module.css";

export interface ProcessDetailData {
  key: string;
  /** 命令/应用名 */
  title: string;
  /** 副标题：如 PID · 用户 */
  subtitle?: string;
  /** CPU 占用（百分点，整机口径）；null 显示 — */
  cpu: number | null;
  /** 内存占用（百分点） */
  mem: number | null;
  /** 常驻内存文本（如 "12.4 MB"） */
  rssText?: string;
  /** 附加元信息行 */
  rows?: Array<{ label: string; value: string }>;
}

interface ProcessDetailCardProps {
  data: ProcessDetailData;
  /** 触发行的定位矩形（getBoundingClientRect） */
  anchor: DOMRect | null;
  onClose: () => void;
}

/**
 * 进程详情浮卡：独立浮层（不改变列表尺寸），从行位置生长。
 * 再点 / Esc / 点别处 / 窗口失焦即消失（docs/design/principles.md §4）。
 */
export const ProcessDetailCard: React.FC<ProcessDetailCardProps> = ({ data, anchor, onClose }) => {
  const reduced = useReducedMotion();
  const [pos, setPos] = useState<{ left: number; top: number; placement: "right" | "left" } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      return;
    }
    const cardWidth = 260;
    const gap = 10;
    const margin = 8;
    let left = anchor.right + gap;
    let placement: "right" | "left" = "right";
    if (left + cardWidth > window.innerWidth - margin) {
      left = anchor.left - gap - cardWidth;
      placement = "left";
    }
    left = Math.max(margin, left);
    const estimatedHeight = 190;
    const top = Math.min(
      Math.max(margin, anchor.top - 8),
      window.innerHeight - estimatedHeight - margin
    );
    setPos({ left, top, placement });
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(`[data-process-card="true"]`)) {
        return;
      }
      if (target?.closest(`[data-process-row="${data.key}"]`)) {
        // 点自己那一行 = 再点一次收起，由行的 onClick 处理
        return;
      }
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onBlur = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [data.key, onClose]);

  if (!pos) {
    return null;
  }

  return createPortal(
    <motion.div
      data-process-card="true"
      className={styles.card}
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.placement === "right" ? "left center" : "right center" }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 6 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
    >
      <div className={styles.titleRow}>
        <span className={styles.title} title={data.title}>{data.title}</span>
        {data.subtitle && <span className={styles.subtitle}>{data.subtitle}</span>}
      </div>
      <div className={styles.figures}>
        <MetricFigure kind="cpu" icon={<FaMicrochip />} arc={data.cpu == null ? null : data.cpu / 100} value={data.cpu} unit="%" title="CPU 占用" />
        <MetricFigure kind="mem" icon={<FaMemory />} arc={data.mem == null ? null : data.mem / 100} value={data.mem} unit="%" title="内存占用" />
      </div>
      {data.rssText && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>常驻内存</span>
          <span className="figure">{data.rssText}</span>
        </div>
      )}
      {data.rows?.map(row => (
        <div key={row.label} className={styles.metaRow}>
          <span className={styles.metaLabel}>{row.label}</span>
          <span className="figure">{row.value || UNAVAILABLE}</span>
        </div>
      ))}
    </motion.div>,
    document.body
  );
};

export const formatRssKb = (kb: number): string => formatBytes(kb * 1024);

export const formatSharePercent = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? UNAVAILABLE : formatFigure(value);

export default ProcessDetailCard;
