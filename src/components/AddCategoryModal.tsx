import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Category, useServer } from '../context/ServerContext';
import styles from './Modal.module.css';

interface AddCategoryModalProps {
  onClose: () => void;
  parentId?: string;
  editCategory?: Category;
}

export const AddCategoryModal: React.FC<AddCategoryModalProps> = ({ onClose, parentId, editCategory }) => {
  const { addCategory, refreshCategories } = useServer();
  const [name, setName] = useState(editCategory?.name ?? '');
  const [loading, setLoading] = useState(false);
  const isEditing = !!editCategory;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      if (isEditing) {
        await invoke("update_category", {
          id: editCategory.id,
          name: name.trim(),
          parentId: editCategory.parentId,
        });
        await refreshCategories();
      } else {
        await addCategory(name.trim(), parentId);
      }
      onClose();
    } catch (error) {
      console.error(isEditing ? "更新分类失败:" : "新增分类失败:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.content}>
        <h2 className={styles.title}>{isEditing ? '编辑分类' : '新增分类'}</h2>
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
            <button type="submit" disabled={loading}>{loading ? (isEditing ? '保存中...' : '添加中...') : (isEditing ? '保存' : '新增分类')}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
