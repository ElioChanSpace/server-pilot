import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { FaChevronRight } from 'react-icons/fa';
import styles from './ContextMenu.module.css';

export interface ContextMenuAction {
  label?: string;
  icon?: React.ReactNode;
  action?: () => void;
  type?: 'separator';
  children?: ContextMenuAction[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  menuRef?: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}

const SubMenu: React.FC<{
  items: ContextMenuAction[];
  parentRect: DOMRect;
  onClose: () => void;
}> = ({ items, parentRect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: parentRect.top, left: parentRect.right + 2 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let top = parentRect.top;
    let left = parentRect.right + 2;

    // Flip to left if overflowing right
    if (left + rect.width > window.innerWidth - 8) {
      left = parentRect.left - rect.width - 2;
    }
    // Clamp vertically
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    if (top < 8) top = 8;

    setPos({ top, left });
  }, [parentRect]);

  return (
    <div
      ref={ref}
      className={styles.contextMenu}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={i} className={styles.separator} />;
        }
        return (
          <button
            key={i}
            className={styles.contextMenuItem}
            onClick={() => { item.action?.(); onClose(); }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

const MenuItem: React.FC<{
  item: ContextMenuAction;
  onClose: () => void;
}> = ({ item, onClose }) => {
  const [showSub, setShowSub] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasChildren = item.children && item.children.length > 0;

  const scheduleHide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setShowSub(false), 200);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return (
    <div
      className={styles.menuItemWrapper}
      onMouseEnter={() => { if (hasChildren) { cancelHide(); setShowSub(true); } }}
      onMouseLeave={() => { if (hasChildren) scheduleHide(); }}
    >
      <button
        ref={btnRef}
        className={styles.contextMenuItem}
        onClick={() => {
          if (hasChildren) return;
          item.action?.();
          onClose();
        }}
      >
        {item.icon}
        <span className={styles.menuLabel}>{item.label}</span>
        {hasChildren && <FaChevronRight size={9} className={styles.submenuArrow} />}
      </button>
      {showSub && hasChildren && btnRef.current && (
        <SubMenu
          items={item.children!}
          parentRect={btnRef.current.getBoundingClientRect()}
          onClose={onClose}
        />
      )}
    </div>
  );
};

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, actions, menuRef, onClose }) => {
  return (
    <div ref={menuRef} className={styles.contextMenu} style={{ top: y, left: x }}>
      {actions.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={index} className={styles.separator} />;
        }
        return <MenuItem key={index} item={item} onClose={onClose} />;
      })}
    </div>
  );
};
