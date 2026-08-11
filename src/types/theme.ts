export interface AppThemeColors {
  // 主色调
  accent: string;
  accentHover: string;
  accentStrong: string;

  // 背景色
  bgPrimary: string;
  bgSecondary: string;
  bgElevated: string;
  glassBg: string;
  glassBorder: string;
  borderColor: string;
  shadowColor: string;

  // 文字色
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // 表面色
  surfaceHover: string;
  surfaceActive: string;
  surfaceOverlay: string;

  // 侧边栏
  sidebarBg: string;
  sidebarText: string;
  sidebarTextSecondary: string;
  sidebarItemBg: string;
  sidebarItemHoverBg: string;

  // 状态色
  success: string;
  warning: string;
  danger: string;
  dangerHover: string;
  error: string;
  info: string;
  debug: string;
  dangerSoft: string;

  // 终端色（可选覆盖）
  terminalBg?: string;
  terminalFg?: string;
  terminalCursor?: string;
  terminalSelection?: string;

  // 背景渐变
  bodyGradient: string;
}

export interface AppTheme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: AppThemeColors;
}

export interface ThemeExportFormat {
  version: number;
  type: 'server-pilot-theme';
  theme: AppTheme;
}
