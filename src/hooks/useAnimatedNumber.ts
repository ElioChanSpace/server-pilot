import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * 克制版读数缓动：数值在约 300ms 内追到新读数（ease-out），
 * 到达即停，不做常驻动画（docs/design/principles.md）。
 * 开启「减少动态效果」时直接跳变。
 */
export function useAnimatedNumber(value: number | null | undefined, durationMs = 300): number | null {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<number | null>(value ?? null);
  const fromRef = useRef<number | null>(value ?? null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      setDisplay(null);
      fromRef.current = null;
      return;
    }
    if (reduced || fromRef.current == null) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (value - from) * eased;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      fromRef.current = value;
    };
  }, [value, durationMs, reduced]);

  return display;
}
