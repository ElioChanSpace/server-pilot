import React, { useState } from 'react';
import { useServer } from '../context/ServerContext';
import styles from './Modal.module.css';

interface AddCategoryModalProps {
  onClose: () => void;
  parentId?: string;
}

export const AddCategoryModal: React.FC<AddCategoryModalProps> = ({ onClose, parentId }) => {
  const { addCategory } = useServer();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await addCategory(name.trim(), parentId);
      onClose();
    } catch (error) {
      console.error("新增分类失败:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.content}>
        <h2 className={styles.title}>新增分类</h2>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>分类名称</label>
            <input 
              type="text" 
              required 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：生产环境、预发布环境"
              autoFocus
            />
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={onClose} className={styles.secondaryButton}>取消</button>
            <button type="submit" disabled={loading}>{loading ? '添加中...' : '新增分类'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
