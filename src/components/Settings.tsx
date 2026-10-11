import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import {
  FaKey, FaDownload, FaUpload, FaCheck, FaCode, FaTimes,
  FaClock, FaWindowMinimize, FaBell, FaShieldAlt, FaHistory, FaChevronDown,
} from "react-icons/fa";
import { useServer } from "../context/ServerContext";
import type { AppSettings } from "../types/settings";
import { APP_THEMES, BUILTIN_THEME_IDS, DEFAULT_THEME } from "../utils/app-themes";
import { exportTheme, importTheme } from "../utils/theme-helpers";
import { SshKeyManager } from "./SshKeyManager";
import RoundSwitch from "./ui/RoundSwitch";
import styles from "./Settings.module.css";

interface SyntaxPlugin {
  id: string;
  name: string;
  description: string;
  extensions: string[];
  enabled: boolean;
  builtin: boolean;
}

const DEFAULT_SYNTAX_PLUGINS: SyntaxPlugin[] = [
  { id: "python", name: "Python", description: "Python 高亮 + 补全/诊断", extensions: [".py", ".pyw", ".pyi"], enabled: true, builtin: true },
  { id: "rust", name: "Rust", description: "Rust 高亮", extensions: [".rs"], enabled: true, builtin: true },
  { id: "java", name: "Java", description: "Java 高亮", extensions: [".java", ".class"], enabled: true, builtin: true },
  { id: "shell", name: "Shell/Bash", description: "Shell 脚本语法高亮支持", extensions: [".sh", ".bash", ".zsh"], enabled: true, builtin: true },
  { id: "markdown", name: "Markdown", description: "Markdown 高亮", extensions: [".md", ".markdown"], enabled: true, builtin: true },
  { id: "javascript", name: "JavaScript", description: "JavaScript 高亮", extensions: [".js", ".jsx", ".mjs"], enabled: true, builtin: true },
  { id: "typescript", name: "TypeScript", description: "TypeScript 高亮", extensions: [".ts", ".tsx"], enabled: true, builtin: true },
  { id: "go", name: "Go", description: "Go 高亮", extensions: [".go"], enabled: true, builtin: true },
  { id: "css", name: "CSS", description: "CSS 高亮", extensions: [".css", ".scss", ".less"], enabled: true, builtin: true },
  { id: "html", name: "HTML", description: "HTML 高亮", extensions: [".html", ".htm"], enabled: true, builtin: true },
  { id: "json", name: "JSON", description: "JSON 高亮", extensions: [".json"], enabled: true, builtin: true },
  { id: "yaml", name: "YAML", description: "YAML 高亮", extensions: [".yaml", ".yml"], enabled: true, builtin: true },
  { id: "sql", name: "SQL", description: "SQL 高亮", extensions: [".sql"], enabled: true, builtin: true },
  { id: "dockerfile", name: "Dockerfile", description: "Dockerfile 高亮", extensions: ["Dockerfile"], enabled: true, builtin: true },
];

const defaultSettings: AppSettings = {
  terminalIdleDisconnectEnabled: true,
  terminalIdleDisconnectMinutes: 30,
  terminalFontSize: 14,
  terminalScrollback: 5000,
  minimizeToTrayOnClose: false,
  themePreference: DEFAULT_THEME,
  notificationsEnabled: true,
  confirmOnDisconnect: true,
  restoreSessionsOnLaunch: true,
};

interface SettingsProps {
  onClose: () => void;
  /** 即改即存：把改动同步到应用状态与后端（docs/design/principles.md §8） */
  onPersistSettings?: (next: AppSettings) => void;
}

export const Settings: React.FC<SettingsProps> = ({ onClose, onPersistSettings }) => {
  const { refreshServers, refreshCategories } = useServer();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSshKeyManager, setShowSshKeyManager] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [syntaxPlugins] = useState<SyntaxPlugin[]>(DEFAULT_SYNTAX_PLUGINS);
  const dirtyRef = useRef(false);

  // Load settings and custom themes on mount
  useEffect(() => {
    void (async () => {
      try {
        const [data, customThemes] = await Promise.all([
          invoke<AppSettings>("get_app_settings"),
          invoke<{ appThemes: Record<string, unknown> }>("get_custom_themes"),
        ]);
        setSettings(data);
        // Merge custom app themes
        if (customThemes.appThemes && typeof customThemes.appThemes === 'object') {
          for (const [id, theme] of Object.entries(customThemes.appThemes)) {
            APP_THEMES[id] = theme as typeof APP_THEMES[string];
          }
        }
        setError(null);
      } catch (loadError) {
        console.error("加载应用设置失败:", loadError);
        setError("加载设置失败，请稍后重试。");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  /** 改动即生效：写入本地状态，防抖后持久化并同步应用 */
  const applyChange = useCallback((partial: Partial<AppSettings>) => {
    dirtyRef.current = true;
    setSettings(prev => {
      const next = { ...prev, ...partial };
      if (next.terminalIdleDisconnectMinutes < 1) {
        next.terminalIdleDisconnectMinutes = 1;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isLoading || !dirtyRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      dirtyRef.current = false;
      if (onPersistSettings) {
        // App 侧负责持久化与状态同步
        onPersistSettings(settings);
      } else {
        void invoke("update_app_settings", { payload: settings }).catch(saveError => {
          console.error("保存应用设置失败:", saveError);
          setError(saveError instanceof Error ? saveError.message : String(saveError));
        });
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, isLoading]);

  const handleExport = async () => {
    const targetPath = await save({
      title: "导出配置",
      defaultPath: "server-pilot-backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof targetPath !== "string") {
      return;
    }

    try {
      await invoke("export_app_data", { savePath: targetPath });
      setNotice("配置已导出（不含任何密码）。");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  };

  const handleImport = async () => {
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: "导入配置",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof sourcePath !== "string") {
      return;
    }

    try {
      const count = await invoke<number>("import_app_data", { loadPath: sourcePath });
      await refreshServers();
      await refreshCategories();
      setNotice(`已导入 ${count} 台服务器，凭据已迁移到系统钥匙串。`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  const handleExportTheme = async () => {
    const currentTheme = APP_THEMES[settings.themePreference] ?? APP_THEMES[DEFAULT_THEME];
    const themeJson = exportTheme(currentTheme);

    const targetPath = await save({
      title: "导出主题",
      defaultPath: `${currentTheme.name}-theme.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof targetPath !== "string") {
      return;
    }

    try {
      // 使用 Tauri fs API 写入文件
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(targetPath, themeJson);
      setNotice("主题已导出。");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  };

  const handleImportTheme = async () => {
    const sourcePath = await open({
      multiple: false,
      directory: false,
      title: "导入主题",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof sourcePath !== "string") {
      return;
    }

    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const themeJson = await readTextFile(sourcePath);
      const importedTheme = importTheme(themeJson);

      if (!importedTheme) {
        setError("无效的主题文件格式。");
        return;
      }

      // 添加到主题列表
      APP_THEMES[importedTheme.id] = importedTheme;

      // 持久化到后端
      const customThemes: Record<string, unknown> = {};
      for (const [id, theme] of Object.entries(APP_THEMES)) {
        // 只保存非内置主题
        if (!BUILTIN_THEME_IDS.includes(id)) {
          customThemes[id] = theme;
        }
      }
      await invoke("save_custom_app_themes", { themes: customThemes });

      // 设置为当前主题（即改即生效）
      applyChange({ themePreference: importedTheme.id });

      setNotice(`主题「${importedTheme.name}」已导入并应用。`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.page}>
        <div className={styles.header}>
          <h2 className={styles.title}>设置</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} title="关闭">
            <FaTimes />
          </button>
        </div>
        <p className={styles.description}>
          常用项是开关，改动立即生效并保存；低频数值收在「更多」里。
        </p>

        {isLoading ? (
          <p className={styles.loading}>正在加载设置...</p>
        ) : (
          <>
            <div className={styles.controlBlock}>
              <RoundSwitch
                checked={settings.terminalIdleDisconnectEnabled}
                onChange={checked => applyChange({ terminalIdleDisconnectEnabled: checked })}
                icon={<FaClock />}
                label="终端空闲自动断连"
              />
              <RoundSwitch
                checked={settings.minimizeToTrayOnClose}
                onChange={checked => applyChange({ minimizeToTrayOnClose: checked })}
                icon={<FaWindowMinimize />}
                label="关闭窗口时最小化到托盘"
              />
              <RoundSwitch
                checked={settings.notificationsEnabled}
                onChange={checked => applyChange({ notificationsEnabled: checked })}
                icon={<FaBell />}
                label="桌面通知"
              />
              <RoundSwitch
                checked={settings.confirmOnDisconnect}
                onChange={checked => applyChange({ confirmOnDisconnect: checked })}
                icon={<FaShieldAlt />}
                label="断开连接前确认"
              />
              <RoundSwitch
                checked={settings.restoreSessionsOnLaunch}
                onChange={checked => applyChange({ restoreSessionsOnLaunch: checked })}
                icon={<FaHistory />}
                label="启动后恢复终端会话"
              />
            </div>

            <div className={styles.paletteSection}>
              <span className={styles.fieldLabel}>主题</span>
              <div className={styles.palette}>
                <button
                  type="button"
                  className={styles.paletteItem}
                  title="跟随系统深浅色"
                  onClick={() => applyChange({ themePreference: "system" })}
                >
                  <span className={`${styles.paletteDisc} ${styles.paletteDiscSystem}`}>
                    {settings.themePreference === "system" && (
                      <motion.span layoutId="themeRing" className={styles.paletteRing} />
                    )}
                  </span>
                  <span className={styles.paletteName}>跟随系统</span>
                </button>
                {Object.values(APP_THEMES).map(themeItem => (
                  <button
                    key={themeItem.id}
                    type="button"
                    className={styles.paletteItem}
                    title={themeItem.name}
                    onClick={() => applyChange({ themePreference: themeItem.id })}
                  >
                    <span
                      className={styles.paletteDisc}
                      style={{ background: themeItem.colors.accent }}
                    >
                      <span
                        className={styles.paletteDiscInner}
                        style={{ background: themeItem.colors.bgPrimary }}
                      />
                      {settings.themePreference === themeItem.id && (
                        <motion.span layoutId="themeRing" className={styles.paletteRing} />
                      )}
                    </span>
                    <span className={styles.paletteName}>{themeItem.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className={styles.moreToggle}
              onClick={() => setMoreOpen(prev => !prev)}
              aria-expanded={moreOpen}
            >
              <FaChevronDown size={11} className={moreOpen ? styles.chevronOpen : undefined} />
              <span>更多</span>
            </button>

            {moreOpen && (
              <div className={styles.moreBlock}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>空闲断连时间（分钟）</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    disabled={!settings.terminalIdleDisconnectEnabled}
                    value={settings.terminalIdleDisconnectMinutes}
                    onChange={event => {
                      const nextValue = Number(event.target.value);
                      applyChange({
                        terminalIdleDisconnectMinutes: Number.isFinite(nextValue) ? nextValue : 1,
                      });
                    }}
                    className={styles.numberInput}
                  />
                  <span className={styles.helper}>
                    立即生效，已打开的终端会话也会按新配置参与空闲检测。
                  </span>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>终端字体大小</span>
                  <input
                    type="number"
                    min={12}
                    max={24}
                    step={1}
                    value={settings.terminalFontSize}
                    onChange={event => {
                      const nextValue = Number(event.target.value);
                      applyChange({
                        terminalFontSize: Number.isFinite(nextValue) ? nextValue : 14,
                      });
                    }}
                    className={styles.numberInput}
                  />
                  <span className={styles.helper}>对所有已打开的终端生效，也可在终端内用 Ctrl+= / Ctrl+- 调整。</span>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>终端滚动行数</span>
                  <select
                    value={settings.terminalScrollback}
                    onChange={event => applyChange({ terminalScrollback: Number(event.target.value) })}
                    className="select-css"
                  >
                    <option value={1000}>1000 行</option>
                    <option value={5000}>5000 行</option>
                    <option value={10000}>10000 行</option>
                    <option value={50000}>50000 行</option>
                  </select>
                </label>

                <div className={styles.backupSection}>
                  <span className={styles.fieldLabel}>主题管理</span>
                  <div className={styles.backupActions}>
                    <button type="button" className={styles.backupButton} onClick={() => void handleExportTheme()}>
                      <FaDownload />
                      <span>导出当前主题</span>
                    </button>
                    <button type="button" className={styles.backupButton} onClick={() => void handleImportTheme()}>
                      <FaUpload />
                      <span>导入主题</span>
                    </button>
                  </div>
                </div>

                <div className={styles.backupSection}>
                  <span className={styles.fieldLabel}>语言支持</span>
                  <div className={styles.pluginList}>
                    {syntaxPlugins.map(plugin => (
                      <div key={plugin.id} className={styles.pluginItem}>
                        <div className={styles.pluginInfo}>
                          <div className={styles.pluginHeader}>
                            <FaCode size={14} className={styles.pluginIcon} />
                            <span className={styles.pluginName}>{plugin.name}</span>
                            {plugin.builtin && (
                              <span className={styles.pluginBadge}>内置</span>
                            )}
                          </div>
                          <span className={styles.pluginDesc}>{plugin.description}</span>
                          <span className={styles.pluginExts}>
                            {plugin.extensions.join(", ")}
                          </span>
                        </div>
                        <div className={styles.pluginStatus}>
                          {plugin.enabled ? (
                            <FaCheck size={14} className={styles.pluginEnabled} />
                          ) : (
                            <span className={styles.pluginDisabled}>已禁用</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <span className={styles.helper}>
                    语法高亮由 Monaco 内核（VS Code 同源）提供，未收录的格式按纯文本显示。
                  </span>
                </div>

                <div className={styles.backupSection}>
                  <span className={styles.fieldLabel}>SSH 密钥管理</span>
                  <div className={styles.backupActions}>
                    <button
                      type="button"
                      className={styles.backupButton}
                      onClick={() => setShowSshKeyManager(true)}
                    >
                      <FaKey />
                      <span>管理 SSH 密钥</span>
                    </button>
                  </div>
                </div>

                <div className={styles.backupSection}>
                  <span className={styles.fieldLabel}>数据备份</span>
                  <div className={styles.backupActions}>
                    <button type="button" className={styles.backupButton} onClick={() => void handleExport()}>
                      导出配置
                    </button>
                    <button type="button" className={styles.backupButton} onClick={() => void handleImport()}>
                      导入配置
                    </button>
                  </div>
                  <span className={styles.helper}>导出文件不包含密码，导入后凭据自动迁移到系统钥匙串。</span>
                </div>
              </div>
            )}

            {error && (
              <p className={styles.error}>{error}</p>
            )}
            {notice && (
              <p className={styles.success}>{notice}</p>
            )}
          </>
        )}
      </div>

      {showSshKeyManager && (
        <SshKeyManager onClose={() => setShowSshKeyManager(false)} />
      )}
    </div>
  );
};
