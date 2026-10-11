import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';
import { APP_THEMES, DEFAULT_THEME } from './utils/app-themes';
import { applyTheme, getInitialThemeId } from './utils/theme-helpers';

// 渲染前先落地主题：React 的子组件 effect 早于父组件执行，
// 终端等订阅主题的组件在挂载时就必须拿到当前主题。
applyTheme(APP_THEMES[getInitialThemeId()] ?? APP_THEMES[DEFAULT_THEME]);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
