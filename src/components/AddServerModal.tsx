import React, { useState, useEffect } from 'react';
import { useServer, OsType, Server } from '../context/ServerContext';

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
    password: existingServer?.password ?? '',
    categoryId: existingServer?.categoryId ?? initialCategoryId ?? ''
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
      password: existingServer?.password ?? '',
      categoryId: existingServer?.categoryId ?? initialCategoryId ?? '',
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

  const formGroupStyle: React.CSSProperties = { marginBottom: '16px' };
  const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '8px', fontSize: '14px' };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 style={{ marginBottom: '20px' }}>{isEditMode ? 'Edit Server' : 'Add New Server'}</h2>
        <form onSubmit={handleSubmit}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Operating System</label>
            <select value={osType} onChange={handleOsChange} className="select-css">
              <option value={OsType.Linux}>Linux</option>
              <option value={OsType.Windows}>Windows</option>
            </select>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              required
              autoFocus
              value={formData.name}
              onChange={e => handleFieldChange('name', e.target.value)}
              placeholder="Production Server"
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <div style={{ ...formGroupStyle, flex: 3 }}>
              <label style={labelStyle}>Host</label>
              <input
                type="text"
                required
                value={formData.host}
                onChange={e => handleFieldChange('host', e.target.value)}
                placeholder="192.168.1.1"
              />
            </div>
            <div style={{ ...formGroupStyle, flex: 1 }}>
              <label style={labelStyle}>Port</label>
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

          <div style={formGroupStyle}>
            <label style={labelStyle}>Username</label>
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

          <div style={formGroupStyle}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={e => handleFieldChange('password', e.target.value)}
              placeholder={osType === OsType.Windows ? 'Optional' : 'SSH password (optional)'}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Category</label>
            <select value={formData.categoryId} onChange={e => handleFieldChange('categoryId', e.target.value)} className="select-css">
              <option value="">Uncategorized</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {submitError && (
            <div style={{
              marginTop: '8px',
              padding: '10px 12px',
              borderRadius: '12px',
              border: '1px solid rgba(217, 108, 108, 0.28)',
              background: 'rgba(217, 108, 108, 0.12)',
              color: 'var(--danger-color)',
              fontSize: '13px',
              lineHeight: 1.5,
            }}>
              {submitError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--glass-border)' }}>Cancel</button>
            <button type="submit" disabled={loading}>
              {loading ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Server')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
