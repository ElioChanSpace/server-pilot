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

      bgPrimary: '#0e1723',
      bgSecondary: '#141e2c',
      bgElevated: '#1a2838',
      glassBg: '#111c29',
      glassBorder: '#1e3040',
      borderColor: '#1e3040',
      shadowColor: '#050a12',

      textPrimary: '#eff7f2',
      textSecondary: '#a8c0b8',
      textMuted: '#7d9890',

      surfaceHover: '#1a2838',
      surfaceActive: '#1e3040',
      surfaceOverlay: '#0a1218',

      sidebarBg: '#0c1420',
      sidebarText: '#eff7f2',
      sidebarTextSecondary: '#a8c0b8',
      sidebarItemBg: '#0e1723',
      sidebarItemHoverBg: '#141e2c',

      success: '#65c18c',
      warning: '#f3ba63',
      danger: '#ea7b7b',
      dangerHover: '#f08f8f',
      error: '#ff8b8b',
      info: '#82c9ff',
      debug: '#b3b9d9',
      dangerSoft: '#2a1520',

      terminalBg: '#0d1520',
      terminalFg: '#edf6f0',
      terminalCursor: '#7eb99f',
      terminalSelection: '#1a2e3a',

      bodyGradient: 'linear-gradient(160deg, #09111b 0%, #102130 52%, #173544 100%)',
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

      bgPrimary: '#f8faf9',
      bgSecondary: '#f0f5f2',
      bgElevated: '#ffffff',
      glassBg: '#f5f8f6',
      glassBorder: '#d0ddd6',
      borderColor: '#d0ddd6',
      shadowColor: '#c8d8d0',

      textPrimary: '#24352d',
      textSecondary: '#5f766d',
      textMuted: '#7c928a',

      surfaceHover: '#e8f0ec',
      surfaceActive: '#dce8e2',
      surfaceOverlay: '#dce6e0',

      sidebarBg: '#f0f5f2',
      sidebarText: '#24352d',
      sidebarTextSecondary: '#5f766d',
      sidebarItemBg: '#f5f8f6',
      sidebarItemHoverBg: '#e8f0ec',

      success: '#3da66b',
      warning: '#d89d43',
      danger: '#d96c6c',
      dangerHover: '#e27c7c',
      error: '#d25454',
      info: '#4f8fca',
      debug: '#6f7ba6',
      dangerSoft: '#f0dede',

      terminalBg: '#f5f9f6',
      terminalFg: '#24352d',
      terminalCursor: '#4d8a74',
      terminalSelection: '#d8e8e0',

      bodyGradient: 'linear-gradient(180deg, #f5fbf7 0%, #edf6f2 52%, #e4f0eb 100%)',
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

      bgPrimary: '#0a0a14',
      bgSecondary: '#0f0f1c',
      bgElevated: '#161628',
      glassBg: '#0d0d18',
      glassBorder: '#1e2a3e',
      borderColor: '#1e2a3e',
      shadowColor: '#000005',

      textPrimary: '#e8ecf1',
      textSecondary: '#9aa8b8',
      textMuted: '#6b7a8a',

      surfaceHover: '#141428',
      surfaceActive: '#1a1a35',
      surfaceOverlay: '#060610',

      sidebarBg: '#080810',
      sidebarText: '#e8ecf1',
      sidebarTextSecondary: '#9aa8b8',
      sidebarItemBg: '#0a0a16',
      sidebarItemHoverBg: '#0f0f20',

      success: '#5ec490',
      warning: '#e8b84d',
      danger: '#e06070',
      dangerHover: '#e87888',
      error: '#ff6b6b',
      info: '#5b9bd5',
      debug: '#8892b0',
      dangerSoft: '#281018',

      terminalBg: '#0a0a14',
      terminalFg: '#e8ecf1',
      terminalCursor: '#5b9bd5',
      terminalSelection: '#161630',

      bodyGradient: 'linear-gradient(160deg, #06060c 0%, #0c0c18 52%, #121220 100%)',
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

      bgPrimary: '#f8f4e8',
      bgSecondary: '#f2ebda',
      bgElevated: '#fdf9ee',
      glassBg: '#f5f0e2',
      glassBorder: '#d8ccae',
      borderColor: '#d8ccae',
      shadowColor: '#c8b890',

      textPrimary: '#3d3425',
      textSecondary: '#6b5d4a',
      textMuted: '#8a7d6b',

      surfaceHover: '#efe8d8',
      surfaceActive: '#e5dcc8',
      surfaceOverlay: '#e0d8c0',

      sidebarBg: '#f2ebda',
      sidebarText: '#3d3425',
      sidebarTextSecondary: '#6b5d4a',
      sidebarItemBg: '#f5f0e2',
      sidebarItemHoverBg: '#efe8d8',

      success: '#6b8f55',
      warning: '#b89040',
      danger: '#b85a4a',
      dangerHover: '#c86a5a',
      error: '#a04a3a',
      info: '#5a8ab0',
      debug: '#7a8090',
      dangerSoft: '#eed8d0',

      terminalBg: '#f5f0e0',
      terminalFg: '#3d3425',
      terminalCursor: '#8b7355',
      terminalSelection: '#e5dcc8',

      bodyGradient: 'linear-gradient(180deg, #faf5e6 0%, #f5eeda 52%, #f0e8d0 100%)',
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

      bgPrimary: '#1e1f1c',
      bgSecondary: '#272822',
      bgElevated: '#2d2e28',
      glassBg: '#232420',
      glassBorder: '#3a3c32',
      borderColor: '#3a3c32',
      shadowColor: '#0a0a08',

      textPrimary: '#f8f8f2',
      textSecondary: '#a8a898',
      textMuted: '#75715e',

      surfaceHover: '#2a2c24',
      surfaceActive: '#333530',
      surfaceOverlay: '#141510',

      sidebarBg: '#1a1b18',
      sidebarText: '#f8f8f2',
      sidebarTextSecondary: '#a8a898',
      sidebarItemBg: '#1e1f1c',
      sidebarItemHoverBg: '#272822',

      success: '#a6e22e',
      warning: '#e6db74',
      danger: '#f92672',
      dangerHover: '#ff4088',
      error: '#f92672',
      info: '#66d9ef',
      debug: '#ae81ff',
      dangerSoft: '#2a1020',

      terminalBg: '#272822',
      terminalFg: '#f8f8f2',
      terminalCursor: '#f8f8f0',
      terminalSelection: '#3a3c34',

      bodyGradient: 'linear-gradient(160deg, #1a1b18 0%, #1e1f1c 52%, #222320 100%)',
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

      bgPrimary: '#1e1f28',
      bgSecondary: '#282a36',
      bgElevated: '#303240',
      glassBg: '#232530',
      glassBorder: '#3a3e50',
      borderColor: '#3a3e50',
      shadowColor: '#0a0a10',

      textPrimary: '#f8f8f2',
      textSecondary: '#b8b8a8',
      textMuted: '#6272a4',

      surfaceHover: '#2c2e3e',
      surfaceActive: '#343648',
      surfaceOverlay: '#141520',

      sidebarBg: '#1a1b24',
      sidebarText: '#f8f8f2',
      sidebarTextSecondary: '#b8b8a8',
      sidebarItemBg: '#1e1f28',
      sidebarItemHoverBg: '#282a36',

      success: '#50fa7b',
      warning: '#f1fa8c',
      danger: '#ff5555',
      dangerHover: '#ff7777',
      error: '#ff5555',
      info: '#8be9fd',
      debug: '#bd93f9',
      dangerSoft: '#2a1018',

      terminalBg: '#282a36',
      terminalFg: '#f8f8f2',
      terminalCursor: '#f8f8f2',
      terminalSelection: '#343648',

      bodyGradient: 'linear-gradient(160deg, #191a21 0%, #1e1f2b 52%, #22232e 100%)',
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

      bgPrimary: '#001a22',
      bgSecondary: '#002b36',
      bgElevated: '#073642',
      glassBg: '#002832',
      glassBorder: '#1a4050',
      borderColor: '#1a4050',
      shadowColor: '#000810',

      textPrimary: '#93a1a1',
      textSecondary: '#839496',
      textMuted: '#586e75',

      surfaceHover: '#073642',
      surfaceActive: '#0a4050',
      surfaceOverlay: '#001018',

      sidebarBg: '#001520',
      sidebarText: '#93a1a1',
      sidebarTextSecondary: '#839496',
      sidebarItemBg: '#001a22',
      sidebarItemHoverBg: '#002b36',

      success: '#859900',
      warning: '#b58900',
      danger: '#dc322f',
      dangerHover: '#e84845',
      error: '#dc322f',
      info: '#268bd2',
      debug: '#6c71c4',
      dangerSoft: '#2a1010',

      terminalBg: '#002b36',
      terminalFg: '#839496',
      terminalCursor: '#839496',
      terminalSelection: '#073642',

      bodyGradient: 'linear-gradient(160deg, #001a20 0%, #002129 52%, #002b36 100%)',
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

      bgPrimary: '#242832',
      bgSecondary: '#2e3440',
      bgElevated: '#363c4a',
      glassBg: '#282c38',
      glassBorder: '#3a4050',
      borderColor: '#3a4050',
      shadowColor: '#0a0c12',

      textPrimary: '#e5e9f0',
      textSecondary: '#d8dee9',
      textMuted: '#4c566a',

      surfaceHover: '#323848',
      surfaceActive: '#3a4050',
      surfaceOverlay: '#181c24',

      sidebarBg: '#1e2230',
      sidebarText: '#e5e9f0',
      sidebarTextSecondary: '#d8dee9',
      sidebarItemBg: '#242832',
      sidebarItemHoverBg: '#2e3440',

      success: '#a3be8c',
      warning: '#ebcb8b',
      danger: '#bf616a',
      dangerHover: '#d08770',
      error: '#bf616a',
      info: '#81a1c1',
      debug: '#b48ead',
      dangerSoft: '#2a1820',

      terminalBg: '#2e3440',
      terminalFg: '#d8dee9',
      terminalCursor: '#d8dee9',
      terminalSelection: '#3a4050',

      bodyGradient: 'linear-gradient(160deg, #1a1d24 0%, #242933 52%, #2e3440 100%)',
    },
  },
};

export const DEFAULT_THEME = 'dark';
