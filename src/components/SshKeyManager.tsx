import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FaKey, FaCopy, FaPlus, FaSync } from "react-icons/fa";
import styles from "./SshKeyManager.module.css";

interface SshKeyPair {
  keyType: string;
  publicKey: string;
  privateKeyPath: string;
  publicKeyPath: string;
  fingerprint: string;
}

interface SshKeyManagerProps {
  onClose: () => void;
  onKeySelected?: (keyPath: string) => void;
}

export const SshKeyManager: React.FC<SshKeyManagerProps> = ({ onClose, onKeySelected }) => {
  const [keys, setKeys] = useState<SshKeyPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [keyType, setKeyType] = useState("ed25519");
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<SshKeyPair[]>("list_ssh_keys");
      setKeys(result);
    } catch (err) {
      console.error("Failed to load SSH keys:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const newKey = await invoke<SshKeyPair>("generate_ssh_key", {
        keyType,
        comment: comment || undefined,
        passphrase: passphrase || undefined,
      });
      setKeys(prev => [...prev, newKey]);
      setSuccess(`密钥已生成: ${newKey.privateKeyPath}`);
      setShowGenerateForm(false);
      setComment("");
      setPassphrase("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyPublicKey = async (publicKey: string, index: number) => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h2>
            <FaKey className={styles.headerIcon} />
            SSH 密钥管理
          </h2>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>{success}</div>}

          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setShowGenerateForm(!showGenerateForm)}
            >
              <FaPlus />
              <span>生成新密钥</span>
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadKeys()}
              disabled={loading}
            >
              <FaSync />
              <span>刷新</span>
            </button>
          </div>

          {showGenerateForm && (
            <div className={styles.generateForm}>
              <h3>生成新密钥</h3>
              <div className={styles.formGroup}>
                <label>密钥类型</label>
                <select value={keyType} onChange={e => setKeyType(e.target.value)}>
                  <option value="ed25519">Ed25519 (推荐)</option>
                  <option value="rsa">RSA</option>
                  <option value="ecdsa">ECDSA</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>注释 (可选)</label>
                <input
                  type="text"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="user@hostname"
                />
              </div>
              <div className={styles.formGroup}>
                <label>密码短语 (可选)</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={e => setPassphrase(e.target.value)}
                  placeholder="留空表示无密码"
                />
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void handleGenerate()}
                  disabled={generating}
                >
                  {generating ? "生成中..." : "生成"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowGenerateForm(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className={styles.keyList}>
            <h3>现有密钥</h3>
            {loading ? (
              <div className={styles.loading}>加载中...</div>
            ) : keys.length === 0 ? (
              <div className={styles.empty}>暂无 SSH 密钥</div>
            ) : (
              keys.map((key, index) => (
                <div key={key.privateKeyPath} className={styles.keyItem}>
                  <div className={styles.keyHeader}>
                    <FaKey className={styles.keyIcon} />
                    <div className={styles.keyInfo}>
                      <span className={styles.keyType}>{key.keyType.toUpperCase()}</span>
                      <span className={styles.keyPath}>{key.privateKeyPath}</span>
                    </div>
                    {onKeySelected && (
                      <button
                        type="button"
                        className={styles.selectButton}
                        onClick={() => onKeySelected(key.privateKeyPath)}
                      >
                        使用此密钥
                      </button>
                    )}
                  </div>
                  <div className={styles.keyDetails}>
                    <div className={styles.fingerprint}>
                      <span className={styles.label}>指纹:</span>
                      <span className={styles.value}>{key.fingerprint}</span>
                    </div>
                    <div className={styles.publicKeyRow}>
                      <span className={styles.label}>公钥:</span>
                      <code className={styles.publicKey}>
                        {key.publicKey.length > 50
                          ? key.publicKey.substring(0, 50) + "..."
                          : key.publicKey}
                      </code>
                      <button
                        type="button"
                        className={styles.copyButton}
                        onClick={() => void handleCopyPublicKey(key.publicKey, index)}
                        title="复制公钥"
                      >
                        <FaCopy />
                        {copiedIndex === index && <span className={styles.copiedHint}>已复制</span>}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
