import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Server } from '../context/ServerContext';
import {
  FaBolt, FaCalendarAlt, FaChartLine, FaColumns, FaCopy, FaCogs, FaDocker,
  FaGlobe, FaHdd, FaHistory, FaInfoCircle, FaNetworkWired, FaRedo, FaMicrochip,
  FaServer, FaTimes, FaTools, FaWindowClose, FaFolderOpen, FaThumbtack,
  FaPen, FaPalette,
} from 'react-icons/fa';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ContextMenu, ContextMenuAction, isEventInsideContextMenu } from './ContextMenu';
import styles from './TabBar.module.css';
import type { TerminalSession } from '../types/terminal';

export type ToolboxTool = 'ports' | 'docker' | 'services' | 'processes' | 'disk' | 'sysinfo' | 'net' | 'logstream' | 'cron' | 'metrics' | 'files';

export interface TabRemoteStatus {
  cwd?: string | null;
  gitBranch?: string | null;
  load1: number;
}

/** 标签配色（VS Code 式左缘色条） */
const TAB_COLORS: Array<{ id: string; value: string; name: string }> = [
  { id: 'red', value: '#f87171', name: '红' },
  { id: 'orange', value: '#fb923c', name: '橙' },
  { id: 'amber', value: '#fbbf24', name: '琥珀' },
  { id: 'green', value: '#4ade80', name: '绿' },
  { id: 'cyan', value: '#22d3ee', name: '青' },
  { id: 'blue', value: '#60a5fa', name: '蓝' },
  { id: 'purple', value: '#c084fc', name: '紫' },
  { id: 'pink', value: '#f472b6', name: '粉' },
];

interface TabBarProps {
  sessions: TerminalSession[];
  servers: Server[];
  currentSessionId: string | null;
  tabStatuses: Record<string, TabRemoteStatus>;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onCloseSessionsToLeft: (sessionId: string) => void;
  onCloseSessionsToRight: (sessionId: string) => void;
  onCloseServerSessions: (sessionId: string) => void;
  onCloseAllSessions: () => void;
  onReconnectSession: (sessionId: string) => void;
  onOpenTool: (tool: ToolboxTool, serverId: string, serverName: string) => void;
  onOpenTransferHistory: () => void;
  followCwdEnabled: boolean;
  onToggleFollowCwd: () => void;
  onReorderSessions: (ordered: TerminalSession[]) => void;
  onUpdateSessionMeta: (sessionId: string, patch: Partial<TerminalSession>) => void;
  onSplitSession: (sessionId: string, layout: 'row' | 'column') => void;
}

interface TabContextMenuState {
  x: number;
  y: number;
  sessionId: string;
}

/** 单个可排序标签 */
const SortableTab: React.FC<{
  sortId: string;
  session: TerminalSession;
  paneCount: number;
  serverName: string;
  username: string;
  active: boolean;
  cwdName: string | null;
  cwdFull: string;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onRenameChange: (v: string) => void;
  onStartRename: () => void;
}> = ({
  sortId,
  session,
  paneCount,
  serverName,
  username,
  active,
  cwdName,
  cwdFull,
  renaming,
  renameValue,
  onSelect,
  onClose,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  onRenameChange,
  onStartRename,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: sortId });
  const displayName = session.alias || serverName;

  return (
    <div
      ref={setNodeRef}
      className={styles.tab}
      data-active={active}
      data-pinned={session.pinned || undefined}
      data-dragging={isDragging || undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(session.color ? { ['--tab-color' as string]: session.color } : {}),
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={onStartRename}
      onMouseDown={e => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      {...attributes}
      {...listeners}
    >
      {session.color && <span className={styles.colorBar} />}
      <span className={styles.statusDot} data-status={session.status} title={session.status} />
      {session.pinned && <FaThumbtack size={8} className={styles.pinIcon} />}
      {renaming ? (
        <input
          className={styles.renameInput}
          value={renameValue}
          autoFocus
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={e => {
            if (e.key === 'Enter') onRenameSubmit();
            if (e.key === 'Escape') onRenameCancel();
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className={styles.tabName} title={`${displayName} · ${username} · ${cwdFull}`}>
          {displayName}
          {!session.alias && <span className={styles.tabDisplayId}> {session.displayId}</span>}
          {paneCount > 1 && <span className={styles.tabDisplayId}> ⟨{paneCount}⟩</span>}
        </span>
      )}
      {cwdName && !renaming && (
        <span className={styles.tabCwd} title={cwdFull}>{cwdName}</span>
      )}
      <button
        type="button"
        className={styles.tabClose}
        title="关闭标签"
        onClick={e => {
          e.stopPropagation();
          onClose();
        }}
      >
        <FaTimes size={9} />
      </button>
    </div>
  );
};

const TabBarComponent: React.FC<TabBarProps> = ({
  sessions,
  servers,
  currentSessionId,
  tabStatuses,
  onSelectSession,
  onCloseSession,
  onDuplicateSession,
  onCloseSessionsToLeft,
  onCloseSessionsToRight,
  onCloseServerSessions,
  onCloseAllSessions,
  onReconnectSession,
  onOpenTool,
  onOpenTransferHistory,
  followCwdEnabled,
  onToggleFollowCwd,
  onReorderSessions,
  onUpdateSessionMeta,
  onSplitSession,
}) => {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // 固定标签置顶（稳定排序），其余保持用户拖拽顺序
  const orderedSessions = useMemo(() => {
    const pinned = sessions.filter(s => s.pinned);
    const rest = sessions.filter(s => !s.pinned);
    return [...pinned, ...rest];
  }, [sessions]);

  // B2: 一标签 = 一个分屏组（同 groupId 的会话同标签）
  const tabGroups = useMemo(() => {
    const map = new Map<string, { key: string; sessions: TerminalSession[] }>();
    for (const s of orderedSessions) {
      const key = s.groupId ?? s.id;
      const list = map.get(key);
      if (list) list.sessions.push(s);
      else map.set(key, { key, sessions: [s] });
    }
    return [...map.values()];
  }, [orderedSessions]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      // Portal 到 body 的子菜单不在 menuRef 子树内，需按标记识别，
      // 否则 pointerdown 先卸载菜单，菜单项永远无法点击。
      if (isEventInsideContextMenu(target)) {
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

  // 拖拽重排
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = tabGroups.findIndex(g => g.key === active.id);
      const newIndex = tabGroups.findIndex(g => g.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const reorderedGroups = arrayMove(tabGroups, oldIndex, newIndex);
      onReorderSessions(reorderedGroups.flatMap(g => g.sessions));
    },
    [tabGroups, onReorderSessions],
  );

  // 快捷键：⌘⇧[ / ⌘⇧] 切换标签，⌘⌥1-9 直达
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const primary = isMac ? e.metaKey : e.ctrlKey;
      if (primary && e.shiftKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const idx = tabGroups.findIndex(g => g.sessions.some(s => s.id === currentSessionId));
        const delta = e.key === ']' ? 1 : -1;
        const target =
          tabGroups[(idx + delta + tabGroups.length) % tabGroups.length];
        if (target) onSelectSession(target.sessions[0].id);
        return;
      }
      if (primary && e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const target = tabGroups[Number(e.key) - 1];
        if (target) onSelectSession(target.sessions[0].id);
        return;
      }
      if (primary && e.key.toLowerCase() === 'd' && currentSessionId) {
        e.preventDefault();
        void onSplitSession(currentSessionId, e.shiftKey ? 'column' : 'row');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabGroups, currentSessionId, onSelectSession, onSplitSession]);

  // 激活标签自动滚动入视口
  useEffect(() => {
    const el = tabsContainerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentSessionId]);

  const startRename = useCallback((session: TerminalSession) => {
    setRenamingId(session.groupId ?? session.id);
    setRenameValue(session.alias ?? '');
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId) {
      onUpdateSessionMeta(renamingId, { alias: renameValue.trim() || undefined });
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onUpdateSessionMeta]);

  if (sessions.length === 0) {
    return null; // 如果没有会话，则不渲染任何内容
  }

  const targetSession = contextMenu
    ? sessions.find(session => session.id === contextMenu.sessionId)
    : null;
  const hasSessionsOnLeft =
    targetSession != null &&
    sessions.findIndex(s => s.id === targetSession.id) > 0;
  const hasSessionsOnRight =
    targetSession != null &&
    sessions.findIndex(s => s.id === targetSession.id) < sessions.length - 1;
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
          label: followCwdEnabled ? '✓ 跟随终端目录' : '跟随终端目录',
          icon: <FaFolderOpen />,
          action: () => {
            onToggleFollowCwd();
          },
        },
        { type: 'separator' },
        {
          label: '向右拆分终端',
          icon: <FaColumns />,
          action: () => {
            void onSplitSession(targetSession.id, 'row');
          },
        },
        {
          label: '向下拆分终端',
          icon: <FaColumns />,
          action: () => {
            void onSplitSession(targetSession.id, 'column');
          },
        },
        { type: 'separator' },
        {
          label: targetSession.pinned ? '取消固定' : '📌 固定标签',
          icon: <FaThumbtack />,
          action: () => {
            onUpdateSessionMeta(targetSession.id, { pinned: !targetSession.pinned });
          },
        },
        {
          label: '标签颜色',
          icon: <FaPalette />,
          children: [
            ...TAB_COLORS.map(c => ({
              label: `${targetSession.color === c.value ? '✓ ' : ''}${c.name}`,
              icon: undefined,
              action: () => {
                onUpdateSessionMeta(targetSession.id, { color: c.value });
              },
            })),
            { type: 'separator' as const },
            {
              label: '无颜色',
              action: () => {
                onUpdateSessionMeta(targetSession.id, { color: undefined });
              },
            },
          ],
        },
        {
          label: '重命名标签',
          icon: <FaPen />,
          action: () => startRename(targetSession),
        },
        { type: 'separator' },
        {
          label: '工具箱',
          icon: <FaTools />,
          children: [
            {
              label: '端口监测',
              icon: <FaNetworkWired />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('ports', server.id, server.name);
              },
            },
            {
              label: 'Docker 管理',
              icon: <FaDocker />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('docker', server.id, server.name);
              },
            },
            {
              label: '服务管理',
              icon: <FaCogs />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('services', server.id, server.name);
              },
            },
            { type: 'separator' },
            {
              label: '进程管理',
              icon: <FaMicrochip />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('processes', server.id, server.name);
              },
            },
            {
              label: '磁盘分析',
              icon: <FaHdd />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('disk', server.id, server.name);
              },
            },
            {
              label: '系统信息',
              icon: <FaInfoCircle />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('sysinfo', server.id, server.name);
              },
            },
            {
              label: '网络连接',
              icon: <FaGlobe />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('net', server.id, server.name);
              },
            },
            {
              label: '实时日志',
              icon: <FaBolt />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('logstream', server.id, server.name);
              },
            },
            {
              label: '定时任务',
              icon: <FaCalendarAlt />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('cron', server.id, server.name);
              },
            },
            {
              label: '资源历史',
              icon: <FaChartLine />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('metrics', server.id, server.name);
              },
            },
            {
              label: '文件管理器',
              icon: <FaColumns />,
              action: () => {
                const server = servers.find(s => s.id === targetSession.serverId);
                if (server) onOpenTool('files', server.id, server.name);
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabGroups.map(g => g.key)} strategy={horizontalListSortingStrategy}>
            <div className={styles.tabList} ref={tabsContainerRef}>
              {tabGroups.map(group => {
                const activePane =
                  group.sessions.find(s => s.id === currentSessionId) ?? group.sessions[0];
                const server = servers.find(item => item.id === activePane.serverId);
                const serverName = server?.name ?? '终端';
                const username = server?.username ?? '';
                const remote = tabStatuses[activePane.id];
                const cwdFull = remote?.cwd ?? '';
                const cwdName = cwdFull
                  ? cwdFull.split('/').filter(Boolean).pop() ?? '/'
                  : null;

                return (
                  <SortableTab
                    key={group.key}
                    sortId={group.key}
                    session={activePane}
                    paneCount={group.sessions.length}
                    serverName={serverName}
                    username={username}
                    active={group.sessions.some(s => s.id === currentSessionId)}
                    cwdName={cwdName}
                    cwdFull={cwdFull}
                    renaming={renamingId === group.key}
                    renameValue={renameValue}
                    onSelect={() => onSelectSession(activePane.id)}
                    onClose={() => group.sessions.forEach(s => onCloseSession(s.id))}
                    onContextMenu={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu({ x: event.clientX, y: event.clientY, sessionId: activePane.id });
                    }}
                    onRenameSubmit={commitRename}
                    onRenameCancel={() => setRenamingId(null)}
                    onRenameChange={setRenameValue}
                    onStartRename={() => startRename(activePane)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
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
