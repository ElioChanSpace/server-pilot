import React, { useState, useRef, useEffect } from "react";
import { FaMoon, FaSun } from "react-icons/fa";
import type { ThemeMode } from "../utils/theme-helpers";

export const MenuBar: React.FC<{
  onNewCategory: () => void;
  onNewServer: () => void;
  onImportSshConfig: () => void;
  onBatchCommand: () => void;
  onViewLogs: () => void;
  onOpenSettings: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}> = ({ onNewCategory, onNewServer, onImportSshConfig, onBatchCommand, onViewLogs, onOpenSettings, theme, onToggleTheme }) => {
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
    if (target.closest('.menuItem') || target.closest('.themeToggle')) {
      return;
    }

    setOpenMenu(null);
  };

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
          </div>
        )}
      </div>
      <div className="menuBarSpacer" />
      <button
        className="themeToggle"
        onClick={onToggleTheme}
        title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      >
        {theme === "dark" ? <FaSun size={14} /> : <FaMoon size={14} />}
        <span>{theme === "dark" ? "浅色" : "深色"}</span>
      </button>
    </div>
  );
};
