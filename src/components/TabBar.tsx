import React, { useEffect, useRef, useState } from 'react';
import { Server } from '../context/ServerContext';
import { FaCopy, FaCogs, FaDocker, FaHistory, FaNetworkWired, FaRedo, FaServer, FaTimes, FaTools, FaWindowClose } from 'react-icons/fa';
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
  onReconnectSession: (sessionId: string) => void;
  onOpenPortMonitor: (serverId: string, serverName: string) => void;
  onOpenDockerManager: (serverId: string, serverName: string) => void;
  onOpenServiceManager: (serverId: string, serverName: string) => void;
  onOpenTransferHistory: () => void;
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
  onReconnectSession,
  onOpenPortMonitor,
  onOpenDockerManager,
  onOpenServiceManager,
  onOpenTransferHistory,
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

  // Format time as HH:MM
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

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
        ...(targetSession.status === 'disconnected'
          ? [{
              label: '重新连接',
              icon: <FaRedo />,
              action: () => {
                onReconnectSession(targetSession.id);
              },
            }]
          : []),
        {
          label: '复制终端',
          icon: <FaCopy />,
          action: () => {
            onDuplicateSession(targetSession.id);
          },
        },
        {
          label: '工具箱',
          icon: <FaTools />,
          children: [
            {
              label: '端口监测',
              icon: <FaNetworkWired />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenPortMonitor(server.id, server.name);
              },
            },
            {
              label: 'Docker 管理',
              icon: <FaDocker />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenDockerManager(server.id, server.name);
              },
            },
            {
              label: '服务管理',
              icon: <FaCogs />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenServiceManager(server.id, server.name);
              },
            },
            { type: 'separator' },
            {
              label: '传输历史',
              icon: <FaHistory />,
              action: () => {
                onOpenTransferHistory();
              },
            },
          ],
        },
        { type: 'separator' },
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
          const serverName = server?.name ?? '终端';
          const username = server?.username ?? '';
          const timeStr = session.createdAt ? formatTime(session.createdAt) : '';
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
              <StatusIcon
                size={12}
                className={`${styles.statusIcon} ${statusMeta.spinning ? styles.statusSpinning : ''}`.trim()}
                style={{ color: statusMeta.color }}
              />
              <div className={styles.tabContent}>
                <div className={styles.tabPrimary}>
                  <span className={styles.tabServerName}>{serverName}</span>
                  {username && <span className={styles.tabUsername}>{username}</span>}
                </div>
                <div className={styles.tabSecondary}>
                  {timeStr && <span className={styles.tabTime}>{timeStr}</span>}
                  <span className={styles.tabDisplayId}>{session.displayId}</span>
                </div>
              </div>
              <button
                className={styles.closeButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSession(session.id);
                }}
                title={`关闭 ${serverName}`}
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
