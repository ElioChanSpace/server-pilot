import React, { useState, useEffect } from 'react';
import { useServer, OsType } from '../context/ServerContext';

interface AddServerModalProps {
  onClose: () => void;
  initialCategoryId?: string;
}

export const AddServerModal: React.FC<AddServerModalProps> = ({ onClose, initialCategoryId }) => {
  const { addServer, categories } = useServer();
  const [osType, setOsType] = useState<OsType>(OsType.Linux);
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 22,
    username: 'root',
    password: '',
    categoryId: initialCategoryId || ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialCategoryId) {
      setFormData(prev => ({ ...prev, categoryId: initialCategoryId }));
    }
  }, [initialCategoryId]);

  const handleOsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newOsType = e.target.value as OsType;
    setOsType(newOsType);
    setFormData(prev => ({
      ...prev,
      port: newOsType === OsType.Windows ? 3389 : 22,
      username: newOsType === OsType.Windows ? 'Administrator' : 'root',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await addServer({
        ...formData,
        osType,
        categoryId: formData.categoryId || undefined,
        password: formData.password || undefined,
      });
      onClose();
    } catch (error) {
      // Error is handled in context
    } finally {
      setLoading(false);
    }
  };

  const formGroupStyle: React.CSSProperties = { marginBottom: '16px' };
  const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '8px', fontSize: '14px' };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 style={{ marginBottom: '20px' }}>Add New Server</h2>
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
            <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Production Server" />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ ...formGroupStyle, flex: 3 }}>
              <label style={labelStyle}>Host</label>
              <input type="text" required value={formData.host} onChange={e => setFormData({...formData, host: e.target.value})} placeholder="192.168.1.1" />
            </div>
            <div style={{ ...formGroupStyle, flex: 1 }}>
              <label style={labelStyle}>Port</label>
              <input type="number" required value={formData.port} onChange={e => setFormData({...formData, port: parseInt(e.target.value)})} />
            </div>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Username</label>
            <input type="text" required value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} />
          </div>

          {osType === OsType.Windows && (
            <div style={formGroupStyle}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="Optional" />
            </div>
          )}

          <div style={formGroupStyle}>
            <label style={labelStyle}>Category</label>
            <select value={formData.categoryId} onChange={e => setFormData({...formData, categoryId: e.target.value})} className="select-css">
              <option value="">Uncategorized</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--glass-border)' }}>Cancel</button>
            <button type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add Server'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};