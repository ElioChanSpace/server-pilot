import React, { useState, useEffect } from 'react';
import { useServer, OsType, Server } from '../context/ServerContext';
import { open } from '@tauri-apps/plugin-dialog';
import styles from './Modal.module.css';

interface AddServerModalProps {
  onClose: () => void;
  initialCategoryId?: string;
  existingServer?: Server;
  onSaved?: (server: Server) => void;
}

const getDefaultUsername = (targetOsType: OsType) => (
  targetOsType === OsType.Windows ? 'Administrator' : 'root'
);

const normalizeUsernameForOs = (username: string, targetOsType: OsType) => {
  const trimmed = username.trim();
  if (targetOsType === OsType.Linux && trimmed.toLowerCase() === 'root') {
    return 'root';
  }

  return trimmed;
};

export const AddServerModal: React.FC<AddServerModalProps> = ({ onClose, initialCategoryId, existingServer, onSaved }) => {
  const { addServer, updateServer, categories } = useServer();
  const isEditMode = Boolean(existingServer);
  const initialOsType = existingServer?.osType ?? OsType.Linux;
  const initialUsername = normalizeUsernameForOs(
    existingServer?.username ?? getDefaultUsername(initialOsType),
    initialOsType,
  );
  const [osType, setOsType] = useState<OsType>(initialOsType);
  const [formData, setFormData] = useState({
    name: existingServer?.name ?? '',
    host: existingServer?.host ?? '',
    port: existingServer?.port ?? 22,
    username: initialUsername,
    password: '',
    categoryId: existingServer?.categoryId ?? initialCategoryId ?? '',
    authMethod: existingServer?.authMethod ?? 'password',
    keyPath: existingServer?.keyPath ?? '',
    keyPassphrase: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const nextOsType = existingServer?.osType ?? OsType.Linux;
    const nextUsername = normalizeUsernameForOs(
      existingServer?.username ?? getDefaultUsername(nextOsType),
      nextOsType,
    );
    setOsType(nextOsType);
    setFormData({
      name: existingServer?.name ?? '',
      host: existingServer?.host ?? '',
      port: existingServer?.port ?? 22,
      username: nextUsername,
      password: '',
      categoryId: existingServer?.categoryId ?? initialCategoryId ?? '',
      authMethod: existingServer?.authMethod ?? 'password',
      keyPath: existingServer?.keyPath ?? '',
      keyPassphrase: '',
    });
    setSubmitError(null);
  }, [existingServer, initialCategoryId]);

  const handleOsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newOsType = e.target.value as OsType;
    setOsType(newOsType);
    setSubmitError(null);
    setFormData(prev => ({
      ...prev,
      port: newOsType === OsType.Windows ? 3389 : 22,
      username: getDefaultUsername(newOsType),
    }));
  };

  const handleFieldChange = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) => {
    setSubmitError(null);
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedPort = Number(formData.port);
    if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
      setSubmitError('端口必须是 1 到 65535 之间的整数。');
      return;
    }

    setLoading(true);
    setSubmitError(null);
    try {
      const payload = {
        name: formData.name.trim(),
        host: formData.host.trim(),
        username: normalizeUsernameForOs(formData.username, osType),
        port: normalizedPort,
        osType,
        categoryId: formData.categoryId || undefined,
        password: formData.password || undefined,
        authMethod: formData.authMethod,
        keyPath: formData.keyPath || undefined,
        keyPassphrase: formData.keyPassphrase || undefined,
      };

      if (existingServer) {
        const savedServer = await updateServer({
          id: existingServer.id,
          ...payload,
        });

        if (onSaved) {
          onSaved(savedServer);
        }
      } else {
        await addServer(payload);
      }

      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handlePickKeyFile = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: '选择 SSH 私钥文件',
    });
    if (typeof selected === 'string') {
      handleFieldChange('keyPath', selected);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.content}>
        <h2 className={styles.title}>{isEditMode ? '编辑服务器' : '新增服务器'}</h2>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>操作系统</label>
            <select value={osType} onChange={handleOsChange} className="select-css">
              <option value={OsType.Linux}>Linux</option>
              <option value={OsType.Windows}>Windows</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>名称</label>
            <input
              type="text"
              required
              autoFocus
              value={formData.name}
              onChange={e => handleFieldChange('name', e.target.value)}
              placeholder="生产服务器"
            />
          </div>

          <div className={styles.formRow}>
            <div className={`${styles.formGroup} ${styles.grow}`}>
              <label className={styles.formLabel}>主机地址</label>
              <input
                type="text"
                required
                value={formData.host}
                onChange={e => handleFieldChange('host', e.target.value)}
                placeholder="192.168.1.1"
              />
            </div>
            <div className={`${styles.formGroup} ${styles.shrink}`}>
              <label className={styles.formLabel}>端口</label>
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={formData.port}
                onChange={e => handleFieldChange('port', e.currentTarget.value === '' ? 0 : e.currentTarget.valueAsNumber)}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>用户名</label>
            <input
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              value={formData.username}
              onChange={e => handleFieldChange('username', e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>密码</label>
            <input
              type="password"
              value={formData.password}
              onChange={e => handleFieldChange('password', e.target.value)}
              placeholder={
                isEditMode && existingServer?.hasPassword
                  ? '已保存密码，留空保持不变'
                  : osType === OsType.Windows
                    ? '选填'
                    : 'SSH 密码（选填）'
              }
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>认证方式</label>
            <select
              value={formData.authMethod}
              onChange={e => handleFieldChange('authMethod', e.target.value as 'password' | 'key')}
              className="select-css"
            >
              <option value="password">密码</option>
              <option value="key">SSH 密钥</option>
            </select>
          </div>

          {formData.authMethod === 'key' && (
            <>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>私钥文件</label>
                <div className={styles.keyRow}>
                  <input
                    type="text"
                    value={formData.keyPath}
                    onChange={e => handleFieldChange('keyPath', e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                    autoComplete="off"
                  />
                  <button type="button" className={styles.secondaryButton} onClick={() => void handlePickKeyFile()}>
                    浏览...
                  </button>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>密钥口令（选填）</label>
                <input
                  type="password"
                  value={formData.keyPassphrase}
                  onChange={e => handleFieldChange('keyPassphrase', e.target.value)}
                  placeholder={
                    isEditMode && existingServer?.hasKeyPassphrase
                      ? '已保存口令，留空保持不变'
                      : '加密私钥的口令'
                  }
                  autoComplete="off"
                />
              </div>
            </>
          )}

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>分组</label>
            <select value={formData.categoryId} onChange={e => handleFieldChange('categoryId', e.target.value)} className="select-css">
              <option value="">未分类</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {submitError && (
            <div className={styles.formError}>
              {submitError}
            </div>
          )}

          <div className={styles.actions}>
            <button type="button" onClick={onClose} className={styles.secondaryButton}>取消</button>
            <button type="submit" disabled={loading}>
              {loading ? (isEditMode ? '保存中...' : '添加中...') : (isEditMode ? '保存修改' : '新增服务器')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
