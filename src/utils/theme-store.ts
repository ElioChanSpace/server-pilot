import type { AppTheme } from "../types/theme";

type ThemeListener = (theme: AppTheme) => void;

let publishedTheme: AppTheme | null = null;
const listeners = new Set<ThemeListener>();

/**
 * 发布当前生效的主题（由 applyTheme 调用）。
 * 终端等不走 CSS 变量的消费者直接订阅这里取色，
 * 避免 getComputedStyle 读自定义属性的时机问题
 * （WebKit 中 MutationObserver 回调里可能读到旧值）。
 */
export const publishTheme = (theme: AppTheme): void => {
  publishedTheme = theme;
  listeners.forEach(listener => listener(theme));
};

/** 当前已发布的主题；applyTheme 尚未运行时为 null */
export const getPublishedTheme = (): AppTheme | null => publishedTheme;

/** 订阅主题变化，返回取消订阅函数。 */
export const subscribeTheme = (listener: ThemeListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
