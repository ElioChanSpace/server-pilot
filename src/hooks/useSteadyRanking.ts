import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 一行的移动方式（docs/design/principles.md §3） */
export type RankMove = "stay" | "slide" | "turnover" | "enter";

export interface RankedEntry<T> {
  item: T;
  key: string;
  /** 当前读数（界面上显示的就是它） */
  value: number;
  /** 排名用的水平值：升即升、降慢 */
  level: number;
  index: number;
  prevIndex: number | null;
  move: RankMove;
  /** 累计移动次数：渲染层用它触发"原地翻页"动画 */
  moveSeq: number;
}

interface SteadyRankingOptions {
  /**
   * 挑战者是否"明显领先"现任（超过阈值才换位）。
   * 默认：领先 12% + 1 点（CPU 百分点场景）。
   */
  isClearlyAhead?: (challenger: number, incumbent: number) => boolean;
  /** 水平值回落时间常数（ms），默认 4000 */
  fallTauMs?: number;
  /** 指针悬停时锁定顺序，默认 true */
  holdOnHover?: boolean;
}

interface SteadyRankingResult<T> {
  ranked: RankedEntry<T>[];
  /** 指针是否悬停在列表上（顺序被锁定） */
  hovered: boolean;
  /** 挂到列表容器上：悬停锁定顺序 */
  listProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
}

const defaultIsClearlyAhead = (challenger: number, incumbent: number) =>
  challenger > incumbent * 1.12 + 1;

/**
 * "要静的列表"（a list that rests）：
 * - 排名用水平值：读数升高立即上升，回落约 fallTauMs 慢衰减；
 * - 相差不超过阈值不换位，避免两条互咬；
 * - 相邻交换 move='slide'，跨多行 move='turnover'（渲染层原地翻页），新进入 'enter'；
 * - 指针悬停时锁定顺序（figures 仍可更新）。
 */
export function useSteadyRanking<T>(
  items: T[],
  keyOf: (item: T) => string,
  valueOf: (item: T) => number,
  options: SteadyRankingOptions = {}
): SteadyRankingResult<T> {
  const {
    isClearlyAhead = defaultIsClearlyAhead,
    fallTauMs = 4000,
    holdOnHover = true,
  } = options;

  const [hovered, setHovered] = useState(false);
  const [ranked, setRanked] = useState<RankedEntry<T>[]>([]);
  const hoveredRef = useRef(false);
  const levelsRef = useRef<Map<string, number>>(new Map());
  const orderRef = useRef<string[]>([]);
  const moveSeqRef = useRef<Map<string, number>>(new Map());
  const lastTickRef = useRef<number>(Date.now());

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;
  const valueOfRef = useRef(valueOf);
  valueOfRef.current = valueOf;
  const isClearlyAheadRef = useRef(isClearlyAhead);
  isClearlyAheadRef.current = isClearlyAhead;

  const recompute = useCallback(() => {
    const now = Date.now();
    const dt = Math.max(0, now - lastTickRef.current) / 1000;
    lastTickRef.current = now;

    const current = itemsRef.current;
    const keyOfFn = keyOfRef.current;
    const valueOfFn = valueOfRef.current;
    const levels = levelsRef.current;

    const present = new Set<string>();
    const valueByKey = new Map<string, number>();

    for (const item of current) {
      const key = keyOfFn(item);
      present.add(key);
      const value = valueOfFn(item);
      valueByKey.set(key, Number.isFinite(value) ? value : 0);
      const prev = levels.get(key);
      if (prev == null || !Number.isFinite(prev)) {
        levels.set(key, value);
      } else if (value >= prev) {
        levels.set(key, value);
      } else {
        // 慢衰减：约 fallTauMs 落到新读数
        const decay = Math.exp(-dt / (fallTauMs / 1000));
        levels.set(key, value + (prev - value) * decay);
      }
    }
    for (const key of Array.from(levels.keys())) {
      if (!present.has(key)) {
        levels.delete(key);
      }
    }

    const levelOf = (key: string) => levels.get(key) ?? valueByKey.get(key) ?? 0;

    // 起点：上一轮顺序（近平局保持相对顺序）；新条目追加后按水平值冒泡
    const prevOrder = orderRef.current.filter(key => present.has(key));
    const prevIndexMap = new Map(prevOrder.map((key, index) => [key, index]));
    const newKeys = Array.from(present).filter(key => !prevIndexMap.has(key));
    newKeys.sort((a, b) => levelOf(b) - levelOf(a));
    let order = [...prevOrder, ...newKeys];

    if (!(hoveredRef.current && holdOnHover)) {
      // 冒泡 + 阈值：只有"明显领先"才换位
      let swapped = true;
      let guard = order.length + 1;
      while (swapped && guard-- > 0) {
        swapped = false;
        for (let i = 0; i < order.length - 1; i++) {
          const a = order[i];
          const b = order[i + 1];
          if (isClearlyAheadRef.current(levelOf(b), levelOf(a))) {
            order[i] = b;
            order[i + 1] = a;
            swapped = true;
          }
        }
      }
    }

    orderRef.current = order;
    const moveSeqMap = moveSeqRef.current;
    setRanked(
      order.map((key, index) => {
        const value = valueByKey.get(key) ?? 0;
        const prevIndex = prevIndexMap.get(key) ?? null;
        let move: RankMove = "stay";
        if (prevIndex == null) {
          move = "enter";
        } else if (prevIndex !== index) {
          move = Math.abs(prevIndex - index) === 1 ? "slide" : "turnover";
        }
        const prevSeq = moveSeqMap.get(key) ?? 0;
        const moveSeq = move === "stay" ? prevSeq : prevSeq + 1;
        moveSeqMap.set(key, moveSeq);
        return {
          item: byKey(current, keyOfFn, key),
          key,
          value,
          level: levelOf(key),
          index,
          prevIndex,
          move,
          moveSeq,
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallTauMs, holdOnHover]);

  // 输入变化（每次采样）时重算
  useEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 低频重算：让水平值自然回落、悬停解除后顺序收敛
  useEffect(() => {
    const timer = window.setInterval(() => {
      recompute();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recompute]);

  const listProps = useMemo(
    () => ({
      onPointerEnter: () => {
        hoveredRef.current = true;
        setHovered(true);
      },
      onPointerLeave: () => {
        hoveredRef.current = false;
        setHovered(false);
        recompute();
      },
    }),
    [recompute]
  );

  return { ranked, hovered, listProps };
}

function byKey<T>(items: T[], keyOf: (item: T) => string, key: string): T {
  for (const item of items) {
    if (keyOf(item) === key) {
      return item;
    }
  }
  throw new Error(`steady ranking: missing item ${key}`);
}
