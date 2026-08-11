import type { AppTheme } from '../types/theme';

export const APP_THEMES: Record<string, AppTheme> = {
  dark: {
    id: 'dark',
    name: '深色（默认）',
    type: 'dark',
    colors: {
      accent: '#6aa88f',
      accentHover: '#7eb99f',
      accentStrong: '#4d8a74',

      bgPrimary: 'rgba(10, 18, 28, 0.68)',
      bgSecondary: 'rgba(18, 28, 40, 0.72)',
      bgElevated: 'rgba(23, 36, 50, 0.82)',
      glassBg: 'rgba(14, 24, 35, 0.62)',
      glassBorder: 'rgba(193, 221, 210, 0.14)',
      borderColor: 'rgba(193, 221, 210, 0.14)',
      shadowColor: 'rgba(3, 10, 18, 0.28)',

      textPrimary: '#eff7f2',
      textSecondary: '#a8c0b8',
      textMuted: '#7d9890',

      surfaceHover: 'rgba(255, 255, 255, 0.08)',
      surfaceActive: 'rgba(106, 168, 143, 0.18)',
      surfaceOverlay: 'rgba(4, 10, 17, 0.52)',

      sidebarBg: 'transparent',
      sidebarText: '#eff7f2',
      sidebarTextSecondary: '#a8c0b8',
      sidebarItemBg: 'rgba(255, 255, 255, 0.04)',
      sidebarItemHoverBg: 'rgba(255, 255, 255, 0.08)',

      success: '#65c18c',
      warning: '#f3ba63',
      danger: '#ea7b7b',
      dangerHover: '#f08f8f',
      error: '#ff8b8b',
      info: '#82c9ff',
      debug: '#b3b9d9',
      dangerSoft: 'rgba(234, 123, 123, 0.16)',

      terminalBg: '#0d1520',
      terminalFg: '#edf6f0',
      terminalCursor: '#7eb99f',
      terminalSelection: 'rgba(126, 185, 159, 0.28)',

      bodyGradient: `radial-gradient(circle at top left, rgba(108, 171, 145, 0.22), transparent 34%),
        radial-gradient(circle at top right, rgba(132, 178, 206, 0.18), transparent 30%),
        linear-gradient(160deg, #09111b 0%, #102130 52%, #173544 100%)`,
    },
  },

  light: {
    id: 'light',
    name: '浅色',
    type: 'light',
    colors: {
      accent: '#5f9f87',
      accentHover: '#74b198',
      accentStrong: '#4d8a74',

      bgPrimary: 'rgba(252, 254, 251, 0.76)',
      bgSecondary: 'rgba(245, 250, 246, 0.86)',
      bgElevated: 'rgba(255, 255, 255, 0.92)',
      glassBg: 'rgba(255, 255, 255, 0.64)',
      glassBorder: 'rgba(126, 158, 145, 0.18)',
      borderColor: 'rgba(126, 158, 145, 0.18)',
      shadowColor: 'rgba(110, 132, 122, 0.12)',

      textPrimary: '#24352d',
      textSecondary: '#5f766d',
      textMuted: '#7c928a',

      surfaceHover: 'rgba(95, 159, 135, 0.1)',
      surfaceActive: 'rgba(95, 159, 135, 0.18)',
      surfaceOverlay: 'rgba(214, 227, 221, 0.48)',

      sidebarBg: 'transparent',
      sidebarText: '#24352d',
      sidebarTextSecondary: '#5f766d',
      sidebarItemBg: 'rgba(95, 159, 135, 0.05)',
      sidebarItemHoverBg: 'rgba(95, 159, 135, 0.1)',

      success: '#3da66b',
      warning: '#d89d43',
      danger: '#d96c6c',
      dangerHover: '#e27c7c',
      error: '#d25454',
      info: '#4f8fca',
      debug: '#6f7ba6',
      dangerSoft: 'rgba(217, 108, 108, 0.14)',

      terminalBg: '#f5f9f6',
      terminalFg: '#24352d',
      terminalCursor: '#4d8a74',
      terminalSelection: 'rgba(95, 159, 135, 0.2)',

      bodyGradient: `radial-gradient(circle at top left, rgba(153, 214, 186, 0.3), transparent 32%),
        radial-gradient(circle at top right, rgba(193, 224, 239, 0.28), transparent 30%),
        linear-gradient(180deg, #f5fbf7 0%, #edf6f2 52%, #e4f0eb 100%)`,
    },
  },

  midnight: {
    id: 'midnight',
    name: '午夜黑',
    type: 'dark',
    colors: {
      accent: '#5b9bd5',
      accentHover: '#7ab3e8',
      accentStrong: '#3a7fc2',

      bgPrimary: 'rgba(8, 8, 16, 0.85)',
      bgSecondary: 'rgba(12, 12, 24, 0.88)',
      bgElevated: 'rgba(18, 18, 32, 0.92)',
      glassBg: 'rgba(10, 10, 20, 0.75)',
      glassBorder: 'rgba(91, 155, 213, 0.15)',
      borderColor: 'rgba(91, 155, 213, 0.15)',
      shadowColor: 'rgba(0, 0, 0, 0.4)',

      textPrimary: '#e8ecf1',
      textSecondary: '#9aa8b8',
      textMuted: '#6b7a8a',

      surfaceHover: 'rgba(91, 155, 213, 0.1)',
      surfaceActive: 'rgba(91, 155, 213, 0.2)',
      surfaceOverlay: 'rgba(0, 0, 0, 0.6)',

      sidebarBg: 'transparent',
      sidebarText: '#e8ecf1',
      sidebarTextSecondary: '#9aa8b8',
      sidebarItemBg: 'rgba(91, 155, 213, 0.05)',
      sidebarItemHoverBg: 'rgba(91, 155, 213, 0.1)',

      success: '#5ec490',
      warning: '#e8b84d',
      danger: '#e06070',
      dangerHover: '#e87888',
      error: '#ff6b6b',
      info: '#5b9bd5',
      debug: '#8892b0',
      dangerSoft: 'rgba(224, 96, 112, 0.15)',

      terminalBg: '#0a0a14',
      terminalFg: '#e8ecf1',
      terminalCursor: '#5b9bd5',
      terminalSelection: 'rgba(91, 155, 213, 0.25)',

      bodyGradient: `radial-gradient(circle at top left, rgba(91, 155, 213, 0.15), transparent 30%),
        radial-gradient(circle at top right, rgba(100, 100, 180, 0.12), transparent 28%),
        linear-gradient(160deg, #06060c 0%, #0c0c18 52%, #121220 100%)`,
    },
  },

  eyecare: {
    id: 'eyecare',
    name: '护眼',
    type: 'light',
    colors: {
      accent: '#8b7355',
      accentHover: '#a08868',
      accentStrong: '#6d5a42',

      bgPrimary: 'rgba(250, 245, 230, 0.85)',
      bgSecondary: 'rgba(245, 238, 220, 0.9)',
      bgElevated: 'rgba(255, 250, 238, 0.95)',
      glassBg: 'rgba(248, 242, 225, 0.75)',
      glassBorder: 'rgba(139, 115, 85, 0.15)',
      borderColor: 'rgba(139, 115, 85, 0.15)',
      shadowColor: 'rgba(120, 100, 70, 0.1)',

      textPrimary: '#3d3425',
      textSecondary: '#6b5d4a',
      textMuted: '#8a7d6b',

      surfaceHover: 'rgba(139, 115, 85, 0.08)',
      surfaceActive: 'rgba(139, 115, 85, 0.15)',
      surfaceOverlay: 'rgba(220, 210, 190, 0.5)',

      sidebarBg: 'transparent',
      sidebarText: '#3d3425',
      sidebarTextSecondary: '#6b5d4a',
      sidebarItemBg: 'rgba(139, 115, 85, 0.05)',
      sidebarItemHoverBg: 'rgba(139, 115, 85, 0.1)',

      success: '#6b8f55',
      warning: '#b89040',
      danger: '#b85a4a',
      dangerHover: '#c86a5a',
      error: '#a04a3a',
      info: '#5a8ab0',
      debug: '#7a8090',
      dangerSoft: 'rgba(184, 90, 74, 0.12)',

      terminalBg: '#f5f0e0',
      terminalFg: '#3d3425',
      terminalCursor: '#8b7355',
      terminalSelection: 'rgba(139, 115, 85, 0.2)',

      bodyGradient: `radial-gradient(circle at top left, rgba(200, 180, 140, 0.25), transparent 32%),
        radial-gradient(circle at top right, rgba(180, 170, 140, 0.2), transparent 30%),
        linear-gradient(180deg, #faf5e6 0%, #f5eeda 52%, #f0e8d0 100%)`,
    },
  },

  monokai: {
    id: 'monokai',
    name: 'Monokai',
    type: 'dark',
    colors: {
      accent: '#a6e22e',
      accentHover: '#b8f246',
      accentStrong: '#8ec20e',

      bgPrimary: 'rgba(30, 31, 28, 0.85)',
      bgSecondary: 'rgba(39, 40, 34, 0.88)',
      bgElevated: 'rgba(45, 46, 40, 0.92)',
      glassBg: 'rgba(35, 36, 32, 0.75)',
      glassBorder: 'rgba(166, 226, 46, 0.12)',
      borderColor: 'rgba(166, 226, 46, 0.12)',
      shadowColor: 'rgba(0, 0, 0, 0.35)',

      textPrimary: '#f8f8f2',
      textSecondary: '#a8a898',
      textMuted: '#75715e',

      surfaceHover: 'rgba(166, 226, 46, 0.08)',
      surfaceActive: 'rgba(166, 226, 46, 0.18)',
      surfaceOverlay: 'rgba(0, 0, 0, 0.5)',

      sidebarBg: 'transparent',
      sidebarText: '#f8f8f2',
      sidebarTextSecondary: '#a8a898',
      sidebarItemBg: 'rgba(166, 226, 46, 0.04)',
      sidebarItemHoverBg: 'rgba(166, 226, 46, 0.08)',

      success: '#a6e22e',
      warning: '#e6db74',
      danger: '#f92672',
      dangerHover: '#ff4088',
      error: '#f92672',
      info: '#66d9ef',
      debug: '#ae81ff',
      dangerSoft: 'rgba(249, 38, 114, 0.15)',

      terminalBg: '#272822',
      terminalFg: '#f8f8f2',
      terminalCursor: '#f8f8f0',
      terminalSelection: 'rgba(73, 72, 62, 0.6)',

      bodyGradient: `radial-gradient(circle at top left, rgba(166, 226, 46, 0.1), transparent 30%),
        radial-gradient(circle at top right, rgba(249, 38, 114, 0.08), transparent 28%),
        linear-gradient(160deg, #1a1b18 0%, #1e1f1c 52%, #222320 100%)`,
    },
  },

  dracula: {
    id: 'dracula',
    name: 'Dracula',
    type: 'dark',
    colors: {
      accent: '#bd93f9',
      accentHover: '#caa8ff',
      accentStrong: '#9b70e0',

      bgPrimary: 'rgba(30, 31, 40, 0.85)',
      bgSecondary: 'rgba(40, 42, 54, 0.88)',
      bgElevated: 'rgba(48, 50, 64, 0.92)',
      glassBg: 'rgba(35, 37, 48, 0.75)',
      glassBorder: 'rgba(189, 147, 249, 0.12)',
      borderColor: 'rgba(189, 147, 249, 0.12)',
      shadowColor: 'rgba(0, 0, 0, 0.35)',

      textPrimary: '#f8f8f2',
      textSecondary: '#b8b8a8',
      textMuted: '#6272a4',

      surfaceHover: 'rgba(189, 147, 249, 0.08)',
      surfaceActive: 'rgba(189, 147, 249, 0.18)',
      surfaceOverlay: 'rgba(0, 0, 0, 0.5)',

      sidebarBg: 'transparent',
      sidebarText: '#f8f8f2',
      sidebarTextSecondary: '#b8b8a8',
      sidebarItemBg: 'rgba(189, 147, 249, 0.04)',
      sidebarItemHoverBg: 'rgba(189, 147, 249, 0.08)',

      success: '#50fa7b',
      warning: '#f1fa8c',
      danger: '#ff5555',
      dangerHover: '#ff7777',
      error: '#ff5555',
      info: '#8be9fd',
      debug: '#bd93f9',
      dangerSoft: 'rgba(255, 85, 85, 0.15)',

      terminalBg: '#282a36',
      terminalFg: '#f8f8f2',
      terminalCursor: '#f8f8f2',
      terminalSelection: 'rgba(68, 71, 90, 0.6)',

      bodyGradient: `radial-gradient(circle at top left, rgba(189, 147, 249, 0.12), transparent 30%),
        radial-gradient(circle at top right, rgba(139, 233, 253, 0.08), transparent 28%),
        linear-gradient(160deg, #191a21 0%, #1e1f2b 52%, #22232e 100%)`,
    },
  },

  solarized: {
    id: 'solarized',
    name: 'Solarized',
    type: 'dark',
    colors: {
      accent: '#268bd2',
      accentHover: '#4a9ed6',
      accentStrong: '#1a6fb0',

      bgPrimary: 'rgba(0, 35, 42, 0.85)',
      bgSecondary: 'rgba(0, 43, 54, 0.88)',
      bgElevated: 'rgba(7, 54, 66, 0.92)',
      glassBg: 'rgba(0, 40, 50, 0.75)',
      glassBorder: 'rgba(38, 139, 210, 0.12)',
      borderColor: 'rgba(38, 139, 210, 0.12)',
      shadowColor: 'rgba(0, 0, 0, 0.35)',

      textPrimary: '#93a1a1',
      textSecondary: '#839496',
      textMuted: '#586e75',

      surfaceHover: 'rgba(38, 139, 210, 0.08)',
      surfaceActive: 'rgba(38, 139, 210, 0.18)',
      surfaceOverlay: 'rgba(0, 0, 0, 0.5)',

      sidebarBg: 'transparent',
      sidebarText: '#93a1a1',
      sidebarTextSecondary: '#839496',
      sidebarItemBg: 'rgba(38, 139, 210, 0.04)',
      sidebarItemHoverBg: 'rgba(38, 139, 210, 0.08)',

      success: '#859900',
      warning: '#b58900',
      danger: '#dc322f',
      dangerHover: '#e84845',
      error: '#dc322f',
      info: '#268bd2',
      debug: '#6c71c4',
      dangerSoft: 'rgba(220, 50, 47, 0.15)',

      terminalBg: '#002b36',
      terminalFg: '#839496',
      terminalCursor: '#839496',
      terminalSelection: 'rgba(7, 54, 66, 0.6)',

      bodyGradient: `radial-gradient(circle at top left, rgba(38, 139, 210, 0.1), transparent 30%),
        radial-gradient(circle at top right, rgba(42, 161, 152, 0.08), transparent 28%),
        linear-gradient(160deg, #001a20 0%, #002129 52%, #002b36 100%)`,
    },
  },

  nord: {
    id: 'nord',
    name: 'Nord',
    type: 'dark',
    colors: {
      accent: '#81a1c1',
      accentHover: '#88b0d0',
      accentStrong: '#5e81ac',

      bgPrimary: 'rgba(36, 40, 50, 0.85)',
      bgSecondary: 'rgba(46, 52, 64, 0.88)',
      bgElevated: 'rgba(54, 60, 74, 0.92)',
      glassBg: 'rgba(40, 44, 56, 0.75)',
      glassBorder: 'rgba(129, 161, 193, 0.12)',
      borderColor: 'rgba(129, 161, 193, 0.12)',
      shadowColor: 'rgba(0, 0, 0, 0.3)',

      textPrimary: '#e5e9f0',
      textSecondary: '#d8dee9',
      textMuted: '#4c566a',

      surfaceHover: 'rgba(129, 161, 193, 0.08)',
      surfaceActive: 'rgba(129, 161, 193, 0.18)',
      surfaceOverlay: 'rgba(0, 0, 0, 0.45)',

      sidebarBg: 'transparent',
      sidebarText: '#e5e9f0',
      sidebarTextSecondary: '#d8dee9',
      sidebarItemBg: 'rgba(129, 161, 193, 0.04)',
      sidebarItemHoverBg: 'rgba(129, 161, 193, 0.08)',

      success: '#a3be8c',
      warning: '#ebcb8b',
      danger: '#bf616a',
      dangerHover: '#d08770',
      error: '#bf616a',
      info: '#81a1c1',
      debug: '#b48ead',
      dangerSoft: 'rgba(191, 97, 106, 0.15)',

      terminalBg: '#2e3440',
      terminalFg: '#d8dee9',
      terminalCursor: '#d8dee9',
      terminalSelection: 'rgba(67, 76, 94, 0.6)',

      bodyGradient: `radial-gradient(circle at top left, rgba(129, 161, 193, 0.1), transparent 30%),
        radial-gradient(circle at top right, rgba(136, 192, 208, 0.08), transparent 28%),
        linear-gradient(160deg, #1a1d24 0%, #242933 52%, #2e3440 100%)`,
    },
  },
};

export const DEFAULT_THEME = 'dark';
