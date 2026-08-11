import type { AppTheme, ThemeExportFormat } from '../types/theme';
import { APP_THEMES, DEFAULT_THEME } from './app-themes';

export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'server-pilot-app-theme';
export const RIGHT_SIDEBAR_WIDTH_KEY = 'server-pilot-right-sidebar-width';
export const MIN_RIGHT_SIDEBAR_WIDTH = 320;
export const MAX_RIGHT_SIDEBAR_WIDTH = 840;

/**
 * 获取初始主题 ID
 */
export const getInitialThemeId = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME;
  }

  const storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedThemeId && APP_THEMES[storedThemeId]) {
    return storedThemeId;
  }

  // 兼容旧版本的 light/dark 设置
  const oldTheme = window.localStorage.getItem('server-pilot-theme');
  if (oldTheme === 'light') {
    return 'light';
  }
  if (oldTheme === 'dark') {
    return 'dark';
  }

  // 跟随系统
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * 获取主题的显示模式（深色/浅色）
 */
export const getThemeMode = (themeId: string): ThemeMode => {
  const theme = APP_THEMES[themeId];
  return theme?.type ?? 'dark';
};

/**
 * 应用主题到 DOM
 */
export const applyTheme = (theme: AppTheme): void => {
  const root = document.documentElement;
  const { colors } = theme;

  // 设置主题类型
  root.dataset.theme = theme.type;
  root.style.colorScheme = theme.type;

  // 设置主题 ID
  root.dataset.themeId = theme.id;

  // 应用颜色变量
  root.style.setProperty('--accent-color', colors.accent);
  root.style.setProperty('--accent-hover', colors.accentHover);
  root.style.setProperty('--accent-strong', colors.accentStrong);

  root.style.setProperty('--bg-primary', colors.bgPrimary);
  root.style.setProperty('--bg-secondary', colors.bgSecondary);
  root.style.setProperty('--bg-elevated', colors.bgElevated);
  root.style.setProperty('--glass-bg', colors.glassBg);
  root.style.setProperty('--glass-border', colors.glassBorder);
  root.style.setProperty('--border-color', colors.borderColor);
  root.style.setProperty('--shadow-color', colors.shadowColor);

  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', colors.textMuted);

  root.style.setProperty('--surface-hover', colors.surfaceHover);
  root.style.setProperty('--surface-active', colors.surfaceActive);
  root.style.setProperty('--surface-overlay', colors.surfaceOverlay);

  root.style.setProperty('--sidebar-bg', colors.sidebarBg);
  root.style.setProperty('--sidebar-text', colors.sidebarText);
  root.style.setProperty('--sidebar-text-secondary', colors.sidebarTextSecondary);
  root.style.setProperty('--sidebar-item-bg', colors.sidebarItemBg);
  root.style.setProperty('--sidebar-item-hover-bg', colors.sidebarItemHoverBg);

  root.style.setProperty('--success-color', colors.success);
  root.style.setProperty('--warning-color', colors.warning);
  root.style.setProperty('--danger-color', colors.danger);
  root.style.setProperty('--danger-color-hover', colors.dangerHover);
  root.style.setProperty('--error-color', colors.error);
  root.style.setProperty('--info-color', colors.info);
  root.style.setProperty('--debug-color', colors.debug);
  root.style.setProperty('--danger-soft', colors.dangerSoft);

  if (colors.terminalBg) {
    root.style.setProperty('--terminal-bg', colors.terminalBg);
  }
  if (colors.terminalFg) {
    root.style.setProperty('--terminal-fg', colors.terminalFg);
  }
  if (colors.terminalCursor) {
    root.style.setProperty('--terminal-cursor', colors.terminalCursor);
  }
  if (colors.terminalSelection) {
    root.style.setProperty('--terminal-selection', colors.terminalSelection);
  }

  root.style.setProperty('--body-gradient', colors.bodyGradient);

  // 保存主题 ID
  window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
};

/**
 * 导出主题为 JSON 字符串
 */
export const exportTheme = (theme: AppTheme): string => {
  const exportFormat: ThemeExportFormat = {
    version: 1,
    type: 'server-pilot-theme',
    theme,
  };
  return JSON.stringify(exportFormat, null, 2);
};

/**
 * 从 JSON 字符串导入主题
 */
export const importTheme = (jsonStr: string): AppTheme | null => {
  try {
    const data = JSON.parse(jsonStr);

    // 验证格式
    if (data.type !== 'server-pilot-theme' || !data.theme) {
      return null;
    }

    const theme = data.theme as AppTheme;

    // 验证必要字段
    if (!theme.id || !theme.name || !theme.type || !theme.colors) {
      return null;
    }

    // 验证类型
    if (theme.type !== 'dark' && theme.type !== 'light') {
      return null;
    }

    // 验证颜色字段
    const requiredColors = [
      'accent', 'accentHover', 'accentStrong',
      'bgPrimary', 'bgSecondary', 'bgElevated',
      'textPrimary', 'textSecondary', 'textMuted',
      'success', 'warning', 'danger',
    ];

    for (const key of requiredColors) {
      if (!theme.colors[key as keyof typeof theme.colors]) {
        return null;
      }
    }

    return theme;
  } catch {
    return null;
  }
};

export const clampRightSidebarWidth = (width: number) =>
  Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, width));
