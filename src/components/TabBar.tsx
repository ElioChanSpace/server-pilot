import React, { useEffect, useRef, useState } from 'react';
import { Server } from '../context/ServerContext';
import { FaCopy, FaServer, FaTimes, FaWindowClose } from 'react-icons/fa';
import { ContextMenu, ContextMenuAction } from './ContextMenu';
import styles from './TabBar.module.css';
import type { TerminalSession } from '../types/terminal';
import { getServerStatusMeta } from '../utils/serverStatus';

interface TabBarProps {
  sessions: TerminalSession[];
  servers: Server[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onCloseSessionsToLeft: (sessionId: string) => void;
  onCloseSessionsToRight: (sessionId: string) => void;
  onCloseServerSessions: (sessionId: string) => void;
  onCloseAllSessions: () => void;
}

interface TabContextMenuState {
  x: number;
  y: number;
  sessionId: string;
}

const TabBarComponent: React.FC<TabBarProps> = ({
  sessions,
  servers,
  currentSessionId,
  onSelectSession,
  onCloseSession,
  onDuplicateSession,
  onCloseSessionsToLeft,
  onCloseSessionsToRight,
  onCloseServerSessions,
  onCloseAllSessions,
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

  const targetSession = contextMenu
    ? sessions.find(session => session.id === contextMenu.sessionId) ?? null
    : null;
  const targetSessionIndex = targetSession
    ? sessions.findIndex(session => session.id === targetSession.id)
    : -1;
  const hasSessionsOnLeft = targetSessionIndex > 0;
  const hasSessionsOnRight = targetSessionIndex >= 0 && targetSessionIndex < sessions.length - 1;
  const currentServerSessionCount = targetSession
    ? sessions.filter(session => session.serverId === targetSession.serverId).length
    : 0;

  const contextMenuActions: ContextMenuAction[] = contextMenu && targetSession
    ? [
        {
          label: '复制终端',
          icon: <FaCopy />,
          action: () => {
            onDuplicateSession(targetSession.id);
          },
        },
        ...(hasSessionsOnLeft
          ? [{
              label: '关闭左侧终端',
              icon: <FaTimes />,
              action: () => {
                onCloseSessionsToLeft(targetSession.id);
              },
            }]
          : []),
        ...(hasSessionsOnRight
          ? [{
              label: '关闭右侧终端',
              icon: <FaTimes />,
              action: () => {
                onCloseSessionsToRight(targetSession.id);
              },
            }]
          : []),
        ...(currentServerSessionCount > 0
          ? [{
              label: '关闭当前服务器所有终端',
              icon: <FaServer />,
              action: () => {
                onCloseServerSessions(targetSession.id);
              },
            }]
          : []),
        ...(sessions.length > 0
          ? [{
              label: '关闭所有终端',
              icon: <FaWindowClose />,
              action: () => {
                onCloseAllSessions();
              },
            }]
          : []),
      ]
    : [];

  return (
    <>
      <div className={styles.tabBar}>
        {sessions.map(session => {
          const server = servers.find(item => item.id === session.serverId);
          const titleBase = server?.name ?? '终端';
          const title = session.terminalIndex > 1 ? `${titleBase} (${session.terminalIndex})` : titleBase;
          const statusMeta = getServerStatusMeta(session.status);
          const StatusIcon = statusMeta.icon;

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
              <span className={styles.tabTitle}>
                <StatusIcon
                  size={12}
                  className={`${styles.statusIcon} ${statusMeta.spinning ? styles.statusSpinning : ''}`.trim()}
                  style={{ color: statusMeta.color }}
                />
                <span className={styles.tabTitleText}>{title}</span>
              </span>
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

export const TabBar = React.memo(TabBarComponent);
