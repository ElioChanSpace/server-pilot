import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FaKey, FaDownload, FaUpload, FaCheck, FaCode, FaTimes } from "react-icons/fa";
import { useServer } from "../context/ServerContext";
import type { AppSettings } from "../types/settings";
import { APP_THEMES, DEFAULT_THEME } from "../utils/app-themes";
import { exportTheme, importTheme } from "../utils/theme-helpers";
import { SshKeyManager } from "./SshKeyManager";
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
  { id: "python", name: "Python", description: "Python 语法高亮支持", extensions: [".py", ".pyw", ".pyi"], enabled: true, builtin: true },
  { id: "rust", name: "Rust", description: "Rust 语法高亮支持", extensions: [".rs"], enabled: true, builtin: true },
  { id: "java", name: "Java", description: "Java 语法高亮支持", extensions: [".java", ".class"], enabled: true, builtin: true },
  { id: "shell", name: "Shell/Bash", description: "Shell 脚本语法高亮支持", extensions: [".sh", ".bash", ".zsh"], enabled: true, builtin: true },
  { id: "markdown", name: "Markdown", description: "Markdown 语法高亮支持", extensions: [".md", ".markdown"], enabled: true, builtin: true },
  { id: "javascript", name: "JavaScript", description: "JavaScript 语法高亮支持", extensions: [".js", ".jsx", ".mjs"], enabled: true, builtin: true },
  { id: "typescript", name: "TypeScript", description: "TypeScript 语法高亮支持", extensions: [".ts", ".tsx"], enabled: true, builtin: true },
  { id: "go", name: "Go", description: "Go 语法高亮支持", extensions: [".go"], enabled: true, builtin: true },
  { id: "css", name: "CSS", description: "CSS 语法高亮支持", extensions: [".css", ".scss", ".less"], enabled: true, builtin: true },
  { id: "html", name: "HTML", description: "HTML 语法高亮支持", extensions: [".html", ".htm"], enabled: true, builtin: true },
  { id: "json", name: "JSON", description: "JSON 语法高亮支持", extensions: [".json"], enabled: true, builtin: true },
  { id: "yaml", name: "YAML", description: "YAML 语法高亮支持", extensions: [".yaml", ".yml"], enabled: true, builtin: true },
  { id: "sql", name: "SQL", description: "SQL 语法高亮支持", extensions: [".sql"], enabled: true, builtin: true },
  { id: "dockerfile", name: "Dockerfile", description: "Dockerfile 语法高亮支持", extensions: ["Dockerfile"], enabled: true, builtin: true },
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
};

interface SettingsProps {
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const { refreshServers, refreshCategories } = useServer();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showSshKeyManager, setShowSshKeyManager] = useState(false);
  const [syntaxPlugins] = useState<SyntaxPlugin[]>(DEFAULT_SYNTAX_PLUGINS);

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

  const handleSave = async () => {
    if (settings.terminalIdleDisconnectEnabled && settings.terminalIdleDisconnectMinutes < 1) {
      setError("空闲断连时间至少为 1 分钟。");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await invoke<AppSettings>("update_app_settings", { payload: settings });
      setSettings(updated);
      setSuccessMessage("设置已保存。");
    } catch (saveError) {
      console.error("保存应用设置失败:", saveError);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

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
      setSuccessMessage("配置已导出（不含任何密码）。");
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
      setSuccessMessage(`已导入 ${count} 台服务器，凭据已迁移到系统钥匙串。`);
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
      setSuccessMessage("主题已导出。");
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
        if (!['dark', 'light', 'midnight', 'eyecare', 'monokai', 'dracula', 'solarized', 'nord'].includes(id)) {
          customThemes[id] = theme;
        }
      }
      await invoke("save_custom_app_themes", { themes: customThemes });

      // 设置为当前主题
      setSettings(prev => ({
        ...prev,
        themePreference: importedTheme.id,
      }));

      setSuccessMessage(`主题「${importedTheme.name}」已导入并应用。`);
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
          配置终端长时间无操作时的自动断连策略。连接失败时，终端标签会保留，便于查看报错输出。
        </p>

        {isLoading ? (
          <p className={styles.loading}>正在加载设置...</p>
        ) : (
          <>
            <label className={styles.fieldRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={settings.terminalIdleDisconnectEnabled}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    terminalIdleDisconnectEnabled: event.target.checked,
                  }));
                }}
              />
              <span className={styles.fieldLabel}>启用终端空闲自动断连</span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>空闲断连时间（分钟）</span>
              <input
                type="number"
                min={1}
                step={1}
                disabled={!settings.terminalIdleDisconnectEnabled}
                value={settings.terminalIdleDisconnectMinutes}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setSettings(prev => ({
                    ...prev,
                    terminalIdleDisconnectMinutes: Number.isFinite(nextValue) ? nextValue : 1,
                  }));
                }}
                className={styles.numberInput}
              />
              <span className={styles.helper}>
                保存后立即生效，已打开的终端会话也会按新配置参与空闲检测。
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
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setSettings(prev => ({
                    ...prev,
                    terminalFontSize: Number.isFinite(nextValue) ? nextValue : 14,
                  }));
                }}
                className={styles.numberInput}
              />
              <span className={styles.helper}>保存后对所有已打开的终端生效，也可在终端内用 Ctrl+= / Ctrl+- 调整。</span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>终端滚动行数</span>
              <select
                value={settings.terminalScrollback}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    terminalScrollback: Number(event.target.value),
                  }));
                }}
                className="select-css"
              >
                <option value={1000}>1000 行</option>
                <option value={5000}>5000 行</option>
                <option value={10000}>10000 行</option>
                <option value={50000}>50000 行</option>
              </select>
            </label>

            <label className={styles.fieldRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={settings.minimizeToTrayOnClose}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    minimizeToTrayOnClose: event.target.checked,
                  }));
                }}
              />
              <span className={styles.fieldLabel}>关闭窗口时最小化到系统托盘</span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>应用主题</span>
              <select
                value={settings.themePreference}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    themePreference: event.target.value,
                  }));
                }}
                className="select-css"
              >
                <optgroup label="深色主题">
                  {Object.values(APP_THEMES)
                    .filter(t => t.type === 'dark')
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </optgroup>
                <optgroup label="浅色主题">
                  {Object.values(APP_THEMES)
                    .filter(t => t.type === 'light')
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </optgroup>
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
              <span className={styles.helper}>导出当前主题配置，或从文件导入自定义主题。</span>
            </div>

            <label className={styles.fieldRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={settings.notificationsEnabled}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    notificationsEnabled: event.target.checked,
                  }));
                }}
              />
              <span className={styles.fieldLabel}>启用桌面通知（断连、上传完成等）</span>
            </label>

            <label className={styles.fieldRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={settings.confirmOnDisconnect}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    confirmOnDisconnect: event.target.checked,
                  }));
                }}
              />
              <span className={styles.fieldLabel}>断开连接前确认</span>
            </label>

            <div className={styles.backupSection}>
              <span className={styles.fieldLabel}>插件管理</span>
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
              <span className={styles.helper}>语法高亮插件由 Syntect 引擎提供支持，所有语言均已内置启用。</span>
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
              <span className={styles.helper}>生成、查看和管理 SSH 密钥对。</span>
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

            {error && (
              <p className={styles.error}>{error}</p>
            )}
            {successMessage && (
              <p className={styles.success}>{successMessage}</p>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                onClick={onClose}
                className={styles.cancelButton}
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={styles.saveButton}
              >
                {isSaving ? "保存中..." : "保存设置"}
              </button>
            </div>
          </>
        )}
      </div>

      {showSshKeyManager && (
        <SshKeyManager onClose={() => setShowSshKeyManager(false)} />
      )}
    </div>
  );
};
