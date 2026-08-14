import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { CommandRecord } from '../types/terminal';
import type { Server, Category } from '../context/ServerContext';
import { FaCopy, FaTimes, FaChevronDown, FaHistory, FaFolder, FaServer, FaTerminal } from 'react-icons/fa';
import styles from './CommandHistoryModal.module.css';

interface CommandHistoryModalProps {
  commands: CommandRecord[];
  servers: Server[];
  categories: Category[];
  initialServerId?: string;
  onClose: () => void;
  onClear: (serverId?: string) => void;
}

// ---- Relative time helper ----
function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;

  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === yesterday.toDateString()) {
    return `昨天 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  if (d.getFullYear() === today.getFullYear()) {
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fullDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// ---- Tree filter dropdown ----
interface TreeDropdownProps {
  servers: Server[];
  categories: Category[];
  commands: CommandRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}

const TreeDropdown: React.FC<TreeDropdownProps> = ({ servers, categories, commands, selectedId, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Build tree structure: root categories + uncategorized servers
  const rootCategories = useMemo(() =>
    categories.filter(c => !c.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [categories]
  );

  const childMap = useMemo(() => {
    const map = new Map<string, Category[]>();
    categories.forEach(c => {
      if (c.parentId) {
        const arr = map.get(c.parentId);
        if (arr) arr.push(c); else map.set(c.parentId, [c]);
      }
    });
    map.forEach(arr => arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    return map;
  }, [categories]);

  const serversByCategory = useMemo(() => {
    const map = new Map<string, Server[]>();
    servers.forEach(s => {
      if (s.categoryId) {
        const arr = map.get(s.categoryId);
        if (arr) arr.push(s); else map.set(s.categoryId, [s]);
      }
    });
    return map;
  }, [servers]);

  const uncategorizedServers = useMemo(() => servers.filter(s => !s.categoryId), [servers]);

  const selectedServer = servers.find(s => s.id === selectedId);
  const selectedLabel = selectedId === 'all' || !selectedServer ? '全部服务器' : selectedServer.name;

  // Count commands per server
  const commandCountByServer = useMemo(() => {
    const map = new Map<string, number>();
    commands.forEach(cmd => map.set(cmd.serverId, (map.get(cmd.serverId) ?? 0) + 1));
    return map;
  }, [commands]);

  const renderServer = (s: Server, depth: number) => {
    const count = commandCountByServer.get(s.id) ?? 0;
    return (
      <div
        key={s.id}
        className={`${styles.treeServer} ${selectedId === s.id ? styles.treeServerActive : ''}`}
        style={{ paddingLeft: `${28 + depth * 16}px` }}
        onClick={() => { onSelect(s.id); setIsOpen(false); }}
      >
        <FaServer size={9} className={styles.treeServerIcon} />
        <span className={styles.treeServerName}>{s.name}</span>
        {count > 0 && <span className={styles.treeServerCount}>{count}</span>}
      </div>
    );
  };

  const renderCategory = (cat: Category, depth: number): React.ReactNode[] => {
    const children = childMap.get(cat.id) ?? [];
    const catServers = serversByCategory.get(cat.id) ?? [];
    const items: React.ReactNode[] = [];

    items.push(
      <div key={`cat-${cat.id}`} className={styles.treeCategory} style={{ paddingLeft: `${12 + depth * 16}px` }}>
        <FaFolder size={10} className={styles.treeCategoryIcon} />
        <span>{cat.name}</span>
      </div>
    );

    catServers.forEach(s => items.push(renderServer(s, depth)));
    children.forEach(cc => items.push(...renderCategory(cc, depth + 1)));

    return items;
  };

  const treeItems: React.ReactNode[] = [];

  // "全部" option
  treeItems.push(
    <div
      key="all"
      className={`${styles.treeAll} ${selectedId === 'all' ? styles.treeServerActive : ''}`}
      onClick={() => { onSelect('all'); setIsOpen(false); }}
    >
      全部服务器
      <span className={styles.treeServerCount}>{commands.length}</span>
    </div>
  );

  // Root categories
  rootCategories.forEach(cat => treeItems.push(...renderCategory(cat, 0)));

  // Uncategorized servers — always show
  if (uncategorizedServers.length > 0) {
    treeItems.push(
      <div key="uncat-header" className={styles.treeCategory} style={{ paddingLeft: '12px' }}>
        <FaFolder size={10} className={styles.treeCategoryIcon} />
        <span>未分类</span>
      </div>
    );
    uncategorizedServers.forEach(s => treeItems.push(renderServer(s, 0)));
  }

  return (
    <div className={styles.dropdownWrapper}>
      <button
        type="button"
        className={styles.dropdownButton}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <span className={styles.dropdownLabel}>{selectedLabel}</span>
        <FaChevronDown size={10} className={styles.dropdownArrow} />
      </button>
      {isOpen && (
        <>
          <div className={styles.dropdownBackdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdownMenu}>
            {treeItems}
          </div>
        </>
      )}
    </div>
  );
};

// ---- Simple dropdown (for terminal filter) ----
interface SimpleDropdownProps {
  label: string;
  items: { key: string; label: string; count?: number }[];
  selectedKey: string;
  onSelect: (key: string) => void;
  icon?: React.ReactNode;
  compact?: boolean;
}

const SimpleDropdown: React.FC<SimpleDropdownProps> = ({ label, items, selectedKey, onSelect, icon, compact }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedItem = items.find(i => i.key === selectedKey);
  const displayLabel = selectedKey === 'all' ? label : (selectedItem?.label ?? label);

  return (
    <div className={styles.dropdownWrapper} style={compact ? { flex: '0 1 auto', minWidth: '120px', maxWidth: '180px' } : undefined}>
      <button
        type="button"
        className={styles.dropdownButton}
        onClick={() => setIsOpen(prev => !prev)}
      >
        {icon}
        <span className={styles.dropdownLabel}>{displayLabel}</span>
        <FaChevronDown size={10} className={styles.dropdownArrow} />
      </button>
      {isOpen && (
        <>
          <div className={styles.dropdownBackdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdownMenu}>
            <div
              className={`${styles.dropdownItem} ${selectedKey === 'all' ? styles.dropdownItemActive : ''}`}
              onClick={() => { onSelect('all'); setIsOpen(false); }}
            >
              {label}
            </div>
            {items.map(item => (
              <div
                key={item.key}
                className={`${styles.dropdownItem} ${selectedKey === item.key ? styles.dropdownItemActive : ''}`}
                onClick={() => { onSelect(item.key); setIsOpen(false); }}
              >
                <span className={styles.dropdownItemLabel}>{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className={styles.dropdownItemCount}>{item.count}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ---- Main modal ----
export const CommandHistoryModal: React.FC<CommandHistoryModalProps> = ({
  commands,
  servers,
  categories,
  initialServerId,
  onClose,
  onClear,
}) => {
  const [selectedServerId, setSelectedServerId] = useState<string>(initialServerId ?? 'all');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Reset terminal filter when server changes
  const handleServerSelect = useCallback((id: string) => {
    setSelectedServerId(id);
    setSelectedSessionId('all');
  }, []);

  // Server-filtered commands (before terminal filter)
  const serverCommands = useMemo(() =>
    selectedServerId === 'all'
      ? commands
      : commands.filter(cmd => cmd.serverId === selectedServerId),
    [commands, selectedServerId]
  );

  // Unique terminal sessions from the current server-filtered commands
  const terminalSessions = useMemo(() => {
    const seen = new Map<string, { sessionId: string; displayId: string; count: number }>();
    serverCommands.forEach(cmd => {
      const existing = seen.get(cmd.sessionId);
      if (existing) {
        existing.count++;
      } else {
        seen.set(cmd.sessionId, { sessionId: cmd.sessionId, displayId: cmd.displayId, count: 1 });
      }
    });
    return Array.from(seen.values());
  }, [serverCommands]);

  // Terminal dropdown items
  const terminalItems = useMemo(() =>
    terminalSessions.map(s => ({
      key: s.sessionId,
      label: s.displayId,
      count: s.count,
    })),
    [terminalSessions]
  );

  // Final filtered commands (server + terminal)
  const filteredCommands = useMemo(() => {
    const base = selectedSessionId === 'all'
      ? serverCommands
      : serverCommands.filter(cmd => cmd.sessionId === selectedSessionId);
    return base.slice(-500);
  }, [serverCommands, selectedSessionId]);

  const totalCount = selectedSessionId === 'all'
    ? serverCommands.length
    : serverCommands.filter(cmd => cmd.sessionId === selectedSessionId).length;
  const truncatedCount = totalCount - filteredCommands.length;

  // Always show displayId column when there are multiple terminal sessions
  const showDisplayId = terminalSessions.length > 1;

  // Auto-scroll to bottom
  useEffect(() => {
    if (filteredCommands.length > prevCountRef.current) {
      const el = scrollRef.current;
      if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
    prevCountRef.current = filteredCommands.length;
  }, [filteredCommands.length]);

  // ESC to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const copyCommand = async (command: string) => {
    try { await navigator.clipboard.writeText(command); } catch { /* silent */ }
  };

  const handleClear = () => {
    if (selectedServerId === 'all') onClear();
    else onClear(selectedServerId);
  };

  const clearLabel = selectedServerId === 'all' ? '清空全部' : '清空当前服务器';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <FaHistory size={15} />
            <span>命令历史</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <FaTimes size={13} />
          </button>
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          <TreeDropdown
            servers={servers}
            categories={categories}
            commands={commands}
            selectedId={selectedServerId}
            onSelect={handleServerSelect}
          />
          {terminalSessions.length > 1 && (
            <SimpleDropdown
              label="全部终端"
              items={terminalItems}
              selectedKey={selectedSessionId}
              onSelect={setSelectedSessionId}
              icon={<FaTerminal size={10} style={{ opacity: 0.5, flexShrink: 0 }} />}
              compact
            />
          )}
          <button type="button" className={styles.clearBtn} onClick={handleClear} title={clearLabel}>
            {clearLabel}
          </button>
        </div>

        {/* Command list */}
        <div ref={scrollRef} className={styles.commandList}>
          {filteredCommands.length === 0 ? (
            <div className={styles.emptyState}>
              <FaHistory size={28} className={styles.emptyIcon} />
              <p>暂无命令记录</p>
              <p className={styles.emptyHint}>在终端中执行的命令会自动记录在这里</p>
            </div>
          ) : (
            filteredCommands.map(cmd => (
              <div
                key={cmd.id}
                className={styles.commandRow}
                onClick={() => void copyCommand(cmd.command)}
                title={`${fullDateTime(cmd.timestamp)}\n终端: ${cmd.displayId}\n点击复制`}
              >
                <span className={styles.commandTime}>{relativeTime(cmd.timestamp)}</span>
                <span className={styles.commandSep} />
                {showDisplayId && (
                  <>
                    <span className={styles.commandDisplayId}>{cmd.displayId}</span>
                    <span className={styles.commandSep} />
                  </>
                )}
                <span className={styles.commandContent}>
                  {selectedServerId === 'all' && (
                    <span className={styles.commandServer}>[{cmd.serverName}]</span>
                  )}
                  <span className={styles.commandText}>{cmd.command}</span>
                </span>
                <FaCopy size={10} className={styles.copyIcon} />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {truncatedCount > 0
            ? `显示最近 ${filteredCommands.length} 条（共 ${totalCount} 条）`
            : `共 ${filteredCommands.length} 条命令`}
        </div>
      </div>
    </div>
  );
};
