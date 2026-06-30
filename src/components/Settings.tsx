import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types/settings";

const cardStyle: React.CSSProperties = {
  maxWidth: 620,
  padding: "16px 18px",
  borderRadius: "14px",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  boxShadow: "0 16px 36px -28px var(--shadow-color)",
  fontSize: "13px",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  marginTop: "14px",
};

const inputStyle: React.CSSProperties = {
  width: "132px",
  padding: "7px 10px",
  borderRadius: "10px",
  border: "1px solid var(--border-color)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontSize: "13px",
};

const helperTextStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "12px",
  lineHeight: 1.45,
};

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
    <div style={{ padding: "16px 18px", overflow: "auto" }}>
      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: "18px", lineHeight: 1.2 }}>设置</h2>
        <p style={{ color: "var(--text-secondary)", marginTop: "8px", lineHeight: 1.5, fontSize: "13px" }}>
          配置终端长时间无操作时的自动断连策略。连接失败时，终端标签会保留，便于查看报错输出。
        </p>

        {isLoading ? (
          <p style={{ color: "var(--text-secondary)", marginTop: "14px", fontSize: "13px" }}>正在加载设置...</p>
        ) : (
          <>
            <label
              style={{
                ...fieldStyle,
                flexDirection: "row",
                alignItems: "center",
                gap: "8px",
                marginTop: "12px",
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                style={{ width: "14px", height: "14px", accentColor: "var(--accent-color)" }}
                checked={settings.terminalIdleDisconnectEnabled}
                onChange={(event) => {
                  setSettings(prev => ({
                    ...prev,
                    terminalIdleDisconnectEnabled: event.target.checked,
                  }));
                }}
              />
              <span style={{ fontSize: "13px", lineHeight: 1.2 }}>启用终端空闲自动断连</span>
            </label>

            <label style={fieldStyle}>
              <span style={{ fontSize: "13px", lineHeight: 1.2 }}>空闲断连时间（分钟）</span>
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
                style={inputStyle}
              />
              <span style={helperTextStyle}>
                保存后立即生效，已打开的终端会话也会按新配置参与空闲检测。
              </span>
            </label>

            {error && (
              <p style={{ color: "var(--danger-color)", marginTop: "12px", fontSize: "12px" }}>{error}</p>
            )}
            {successMessage && (
              <p style={{ color: "var(--success-color, #4caf50)", marginTop: "12px", fontSize: "12px" }}>
                {successMessage}
              </p>
            )}

            <div style={{ marginTop: "18px" }}>
              <button
                onClick={handleSave}
                disabled={isSaving}
                style={{ padding: "8px 14px", fontSize: "13px", borderRadius: "10px" }}
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
