import React, { useEffect, useRef, useState } from 'react';
import { Server } from '../context/ServerContext';
import { FaCopy, FaTimes } from 'react-icons/fa';
import { ContextMenu, ContextMenuAction } from './ContextMenu';
import styles from './TabBar.module.css';
import type { TerminalSession } from '../types/terminal';

interface TabBarProps {
  sessions: TerminalSession[];
  servers: Server[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;
}

interface TabContextMenuState {
  x: number;
  y: number;
  sessionId: string;
}

export const TabBar: React.FC<TabBarProps> = ({
  sessions,
  servers,
  currentSessionId,
  onSelectSession,
  onCloseSession,
  onDuplicateSession,
}) => {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  if (sessions.length === 0) {
    return null; // 如果没有会话，则不渲染任何内容
  }

  const contextMenuActions: ContextMenuAction[] = contextMenu
    ? [
        {
          label: '复制终端',
          icon: <FaCopy />,
          action: () => {
            onDuplicateSession(contextMenu.sessionId);
          },
        },
      ]
    : [];

  return (
    <>
      <div className={styles.tabBar}>
        {sessions.map(session => {
          const server = servers.find(item => item.id === session.serverId);
          const titleBase = server?.name ?? '终端';
          const title = session.terminalIndex > 1 ? `${titleBase} (${session.terminalIndex})` : titleBase;

          return (
            <div
              key={session.id}
              className={styles.tab}
              data-active={session.id === currentSessionId}
              onClick={() => onSelectSession(session.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ x: event.clientX, y: event.clientY, sessionId: session.id });
              }}
            >
              <span className={styles.tabTitle}>{title}</span>
              <button
                className={styles.closeButton}
                onClick={(e) => {
                  e.stopPropagation(); // 防止点击关闭按钮时触发标签页的切换事件
                  onCloseSession(session.id);
                }}
                title={`关闭 ${title}`}
              >
                <FaTimes />
              </button>
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenuActions}
          menuRef={contextMenuRef}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
