import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types/settings";
import styles from "./Settings.module.css";

const defaultSettings: AppSettings = {
  terminalIdleDisconnectEnabled: true,
  terminalIdleDisconnectMinutes: 30,
};

export const Settings: React.FC = () => {
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
