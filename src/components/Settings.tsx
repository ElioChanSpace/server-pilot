import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useServer } from "../context/ServerContext";
import type { AppSettings } from "../types/settings";
import styles from "./Settings.module.css";

const defaultSettings: AppSettings = {
  terminalIdleDisconnectEnabled: true,
  terminalIdleDisconnectMinutes: 30,
  terminalFontSize: 14,
  terminalScrollback: 5000,
  minimizeToTrayOnClose: false,
  themePreference: "system",
  notificationsEnabled: true,
  confirmOnDisconnect: true,
};

export const Settings: React.FC = () => {
  const { refreshServers, refreshCategories } = useServer();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    void invoke<AppSettings>("get_app_settings")
      .then(data => {
        setSettings(data);
        setError(null);
      })
      .catch(loadError => {
        console.error("加载应用设置失败:", loadError);
        setError("加载设置失败，请稍后重试。");
      })
      .finally(() => {
        setIsLoading(false);
      });
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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h2 className={styles.title}>设置</h2>
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
              <span className={styles.fieldLabel}>主题</span>
              <select
                value={settings.themePreference}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    themePreference: event.target.value as AppSettings["themePreference"],
                  }));
                }}
                className="select-css"
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>

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
    </div>
  );
};
