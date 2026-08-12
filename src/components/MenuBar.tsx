import React, { useState, useRef, useEffect } from "react";
import { FaMoon, FaSun, FaPalette } from "react-icons/fa";
import type { ThemeMode } from "../utils/theme-helpers";
import { APP_THEMES } from "../utils/app-themes";

export const MenuBar: React.FC<{
  onNewCategory: () => void;
  onNewServer: () => void;
  onImportSshConfig: () => void;
  onBatchCommand: () => void;
  onViewLogs: () => void;
  onOpenSettings: () => void;
  theme: ThemeMode;
  themeId: string;
  onToggleTheme: () => void;
  onChangeTheme: (themeId: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}> = ({ onNewCategory, onNewServer, onImportSshConfig, onBatchCommand, onViewLogs, onOpenSettings, theme, themeId, onToggleTheme, onChangeTheme, isFullscreen, onToggleFullscreen }) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
    };
  }, []);

  const handleItemClick = (action: () => void) => {
    action();
    setOpenMenu(null);
  };

  const handleThemeSelect = (selectedThemeId: string) => {
    onChangeTheme(selectedThemeId);
    setOpenMenu(null);
  };

  const handleMenuBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!openMenu) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Keep existing button/dropdown interactions intact; only close when clicking
    // the menu bar background or spacer area around the top-level menus.
    if (target.closest('.menuItem') || target.closest('.themeToggle') || target.closest('.themeMenu')) {
      return;
    }

    setOpenMenu(null);
  };

  const currentTheme = APP_THEMES[themeId];

  return (
    <div className="menuBar" ref={menuRef} onPointerDown={handleMenuBarPointerDown}>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')} data-active={openMenu === 'file'}>文件</button>
        {openMenu === 'file' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onNewCategory)}>新建分类...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onNewServer)}>新建服务器...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onImportSshConfig)}>从 SSH Config 导入...</button>
            <div className="separator" />
            <button className="dropdownItem" onClick={() => window.close()}>退出</button>
          </div>
        )}
      </div>
      <div className="menuItem">
        <button className="menuButton" onClick={() => setOpenMenu(openMenu === 'system' ? null : 'system')} data-active={openMenu === 'system'}>系统</button>
        {openMenu === 'system' && (
          <div className="dropdown">
            <button className="dropdownItem" onClick={() => handleItemClick(onOpenSettings)}>设置</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onBatchCommand)}>批量执行命令...</button>
            <button className="dropdownItem" onClick={() => handleItemClick(onViewLogs)}>查看日志</button>
            {onToggleFullscreen && (
              <>
                <div className="separator" />
                <button className="dropdownItem" onClick={() => handleItemClick(onToggleFullscreen)}>
                  {isFullscreen ? "退出全屏" : "全屏"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="menuBarSpacer" />
      <div className="menuItem themeMenu">
        <button
          className="themeToggle"
          onClick={() => setOpenMenu(openMenu === 'theme' ? null : 'theme')}
          data-active={openMenu === 'theme'}
          title="切换主题"
          aria-label="切换主题"
        >
          <FaPalette size={14} />
          <span>{currentTheme?.name ?? '主题'}</span>
        </button>
        {openMenu === 'theme' && (
          <div className="dropdown themeDropdown">
            <div className="themeDropdownHeader">深色主题</div>
            {Object.values(APP_THEMES)
              .filter(t => t.type === 'dark')
              .map(t => (
                <button
                  key={t.id}
                  className="dropdownItem themeItem"
                  data-active={t.id === themeId}
                  onClick={() => handleThemeSelect(t.id)}
                >
                  <span className="themeColorPreview" style={{ background: t.colors.accent }} />
                  <span>{t.name}</span>
                </button>
              ))}
            <div className="separator" />
            <div className="themeDropdownHeader">浅色主题</div>
            {Object.values(APP_THEMES)
              .filter(t => t.type === 'light')
              .map(t => (
                <button
                  key={t.id}
                  className="dropdownItem themeItem"
                  data-active={t.id === themeId}
                  onClick={() => handleThemeSelect(t.id)}
                >
                  <span className="themeColorPreview" style={{ background: t.colors.accent }} />
                  <span>{t.name}</span>
                </button>
              ))}
          </div>
        )}
      </div>
      <button
        className="themeToggle"
        onClick={onToggleTheme}
        title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      >
        {theme === "dark" ? <FaSun size={14} /> : <FaMoon size={14} />}
      </button>
    </div>
  );
};
