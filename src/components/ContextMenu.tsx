import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * 判定事件是否落在任意右键菜单（含 Portal 到 body 的子菜单）内。
 * 菜单 Portal 后不再位于调用方 menuRef 的 DOM 子树中，外部点击检测
 * 必须同时识别 [data-context-menu] 标记，否则 pointerdown 会先卸载菜单，
 * 导致菜单项永远点不到。
 */
export function isEventInsideContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[data-context-menu="true"]') !== null;
}

const SubMenu: React.FC<{
  items: ContextMenuAction[];
  parentRect: DOMRect;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = ({ items, parentRect, onClose, onMouseEnter, onMouseLeave }) => {
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

  // Portal to document.body: menus must escape ancestor stacking contexts
  // (content-wrapper z-index, sidebar overflow, backdrop-filter containing
  // blocks) or their items get covered/clipped by surrounding panels.
  return createPortal(
    <div
      ref={ref}
      data-context-menu="true"
      className={styles.contextMenu}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
    </div>,
    document.body,
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
          // SubMenu 已 Portal 到 body，不再是 wrapper 的 DOM 后代，
          // 需要显式接管 hover 才能阻止 200ms 计时器把子菜单关掉。
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      )}
    </div>
  );
};

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, actions, menuRef, onClose }) => {
  // Portal to document.body — see SubMenu for the stacking-context rationale.
  return createPortal(
    <div ref={menuRef} data-context-menu="true" className={styles.contextMenu} style={{ top: y, left: x }}>
      {actions.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={index} className={styles.separator} />;
        }
        return <MenuItem key={index} item={item} onClose={onClose} />;
      })}
    </div>,
    document.body,
  );
};
