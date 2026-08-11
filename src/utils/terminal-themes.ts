export interface TerminalTheme {
  name: string;
  label: string;
  colors: {
    background: string;
    foreground: string;
    cursor: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

export const TERMINAL_THEMES: Record<string, TerminalTheme> = {
  default: {
    name: 'default',
    label: '默认深色',
    colors: {
      background: '#0d1520',
      foreground: '#edf6f0',
      cursor: '#7eb99f',
      selectionBackground: 'rgba(126, 185, 159, 0.28)',
      black: '#000000',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#d7dae0',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },
  monokai: {
    name: 'monokai',
    label: 'Monokai',
    colors: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: 'rgba(73, 72, 62, 0.6)',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
  },
  dracula: {
    name: 'dracula',
    label: 'Dracula',
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: 'rgba(68, 71, 90, 0.6)',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
  solarizedDark: {
    name: 'solarizedDark',
    label: 'Solarized Dark',
    colors: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      selectionBackground: 'rgba(7, 54, 66, 0.6)',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  nord: {
    name: 'nord',
    label: 'Nord',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: 'rgba(67, 76, 94, 0.6)',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  github: {
    name: 'github',
    label: 'GitHub',
    colors: {
      background: '#24292e',
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      selectionBackground: 'rgba(56, 68, 77, 0.6)',
      black: '#586069',
      red: '#ea4a5a',
      green: '#34d058',
      yellow: '#ffea7f',
      blue: '#2188ff',
      magenta: '#b392f0',
      cyan: '#39c5cf',
      white: '#c9d1d9',
      brightBlack: '#959da5',
      brightRed: '#f97583',
      brightGreen: '#85e89d',
      brightYellow: '#ffea7f',
      brightBlue: '#79b8ff',
      brightMagenta: '#b392f0',
      brightCyan: '#56d4dd',
      brightWhite: '#fafbfc',
    },
  },
};

export const DEFAULT_TERMINAL_THEME = 'default';
