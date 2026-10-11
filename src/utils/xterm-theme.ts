import type { ITheme } from "xterm";
import type { AppThemeColors } from "../types/theme";

/**
 * 应用主题的终端色板 → xterm 主题。
 * 直接映射 theme.colors.terminal*（不经 DOM/自定义属性），
 * 保证终端色与主题定义逐字一致。
 */
export const buildXtermTheme = (colors: AppThemeColors): ITheme => ({
  background: colors.terminalBg,
  foreground: colors.terminalFg,
  cursor: colors.terminalCursor,
  selectionBackground: colors.terminalSelection,
  black: colors.terminalBlack,
  red: colors.terminalRed,
  green: colors.terminalGreen,
  yellow: colors.terminalYellow,
  blue: colors.terminalBlue,
  magenta: colors.terminalMagenta,
  cyan: colors.terminalCyan,
  white: colors.terminalWhite,
  brightBlack: colors.terminalBrightBlack,
  brightRed: colors.terminalBrightRed,
  brightGreen: colors.terminalBrightGreen,
  brightYellow: colors.terminalBrightYellow,
  brightBlue: colors.terminalBrightBlue,
  brightMagenta: colors.terminalBrightMagenta,
  brightCyan: colors.terminalBrightCyan,
  brightWhite: colors.terminalBrightWhite,
});
