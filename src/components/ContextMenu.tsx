import React from 'react';
import styles from './ContextMenu.module.css';

export interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  action: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, actions, onClose }) => {
  return (
    <div className={styles.contextMenu} style={{ top: y, left: x }}>
      {actions.map((item, index) => (
        <button key={index} className={styles.contextMenuItem} onClick={() => { item.action(); onClose(); }}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
