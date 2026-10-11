import React from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import styles from "./RoundSwitch.module.css";

interface RoundSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 图标显示在圆盘内 */
  icon?: React.ReactNode;
  /** 文案在圆盘旁（工具类应用保留语义文字） */
  label: string;
  disabled?: boolean;
  title?: string;
}

/**
 * 圆形开关（docs/design/principles.md §8）：
 * 按下有反馈（下压）；打开时颜色从中心扩散并轻微过冲后落定；
 * 关闭时收回。开启「减少动态效果」只做颜色淡入。
 */
export const RoundSwitch: React.FC<RoundSwitchProps> = ({
  checked,
  onChange,
  icon,
  label,
  disabled,
  title,
}) => {
  const reduced = useReducedMotion();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title ?? label}
      className={styles.row}
      onClick={() => onChange(!checked)}
    >
      <motion.span
        className={styles.disc}
        data-checked={checked ? "true" : "false"}
        whileTap={disabled ? undefined : { scale: 0.92 }}
        transition={{ type: "spring", stiffness: 520, damping: 30 }}
      >
        <span
          className={styles.fill}
          style={{
            transform: checked ? "scale(1)" : "scale(0)",
            transition: reduced
              ? "opacity 120ms ease"
              : "transform 260ms cubic-bezier(0.34, 1.2, 0.64, 1)",
            opacity: reduced ? (checked ? 1 : 0) : 1,
          }}
        />
        {icon && <span className={styles.glyph}>{icon}</span>}
      </motion.span>
      <span className={styles.label} data-checked={checked ? "true" : "false"}>
        {label}
      </span>
    </button>
  );
};

export default RoundSwitch;
