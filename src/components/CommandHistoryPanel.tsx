import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { CommandRecord, TerminalSession } from '../types/terminal';
import { FaCopy, FaTrash, FaChevronDown } from 'react-icons/fa';
import styles from './CommandHistoryPanel.module.css';

interface CommandHistoryPanelProps {
  commands: CommandRecord[];
  sessions: TerminalSession[];
  onClear: () => void;
}

export const CommandHistoryPanel: React.FC<CommandHistoryPanelProps> = ({
  commands,
  sessions,
  onClear,
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // 活跃终端列表（去重）
  const activeTerminals = useMemo(() => {
    const seen = new Map<string, { displayId: string; serverName: string }>();
    commands.forEach(cmd => {
      if (!seen.has(cmd.sessionId)) {
        seen.set(cmd.sessionId, { displayId: cmd.displayId, serverName: cmd.serverName });
      }
    });
    sessions.forEach(s => {
      if (!seen.has(s.id)) {
        seen.set(s.id, { displayId: s.displayId, serverName: '' });
      }
    });
    return Array.from(seen.entries()).map(([id, info]) => ({
      sessionId: id,
      displayId: info.displayId,
      serverName: info.serverName,
    }));
  }, [commands, sessions]);

  // 过滤后的命令（最多显示最近 500 条，防止大量 DOM 节点影响性能）
  const MAX_DISPLAY = 500;
  const filteredCommands = useMemo(() => {
    const base = selectedSessionId === 'all' ? commands : commands.filter(cmd => cmd.sessionId === selectedSessionId);
    return base.slice(-MAX_DISPLAY);
  }, [commands, selectedSessionId]);
  const totalCount = selectedSessionId === 'all' ? commands.length : commands.filter(cmd => cmd.sessionId === selectedSessionId).length;
  const truncatedCount = totalCount - filteredCommands.length;

  // 自动滚动到底部
  useEffect(() => {
    if (filteredCommands.length > prevCountRef.current) {
      const el = scrollRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
    prevCountRef.current = filteredCommands.length;
  }, [filteredCommands.length]);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // 静默失败
    }
  };

  const selectedTerminal = activeTerminals.find(t => t.sessionId === selectedSessionId);
  const selectedLabel = selectedSessionId === 'all' || !selectedTerminal
    ? '全部终端'
    : `${selectedTerminal.serverName || '未知'} · ${selectedTerminal.displayId}`;

  return (
    <div className={styles.container}>
      {/* 工具栏 */}
      <div className={styles.toolbar}>
        {/* 终端筛选下拉 */}
        <div className={styles.dropdownWrapper}>
          <button
            type="button"
            className={styles.dropdownButton}
            onClick={() => setIsDropdownOpen(prev => !prev)}
          >
            <span className={styles.dropdownLabel}>{selectedLabel}</span>
            <FaChevronDown size={10} className={styles.dropdownArrow} />
          </button>

          {isDropdownOpen && (
            <>
              <div
                className={styles.dropdownBackdrop}
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className={styles.dropdownMenu}>
                <div
                  className={`${styles.dropdownItem} ${selectedSessionId === 'all' ? styles.dropdownItemActive : ''}`}
                  onClick={() => { setSelectedSessionId('all'); setIsDropdownOpen(false); }}
                >
                  全部终端
                </div>
                {activeTerminals.map(t => (
                  <div
                    key={t.sessionId}
                    className={`${styles.dropdownItem} ${selectedSessionId === t.sessionId ? styles.dropdownItemActive : ''}`}
                    onClick={() => { setSelectedSessionId(t.sessionId); setIsDropdownOpen(false); }}
                  >
                    {t.serverName || '未知'} · {t.displayId}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 清空按钮 */}
        <button
          type="button"
          className={styles.clearButton}
          onClick={onClear}
          title="清空命令历史"
        >
          <FaTrash size={12} />
        </button>
      </div>

      {/* 命令列表 */}
      <div ref={scrollRef} className={styles.commandList}>
        {filteredCommands.length === 0 ? (
          <div className={styles.emptyText}>暂无命令记录</div>
        ) : (
          filteredCommands.map(cmd => (
            <div
              key={cmd.id}
              className={styles.commandItem}
              onClick={() => void copyCommand(cmd.command)}
              title="点击复制"
            >
              <span className={styles.commandTime}>{formatTime(cmd.timestamp)}</span>
              {selectedSessionId === 'all' && (
                <span className={styles.commandDisplayId}>{cmd.displayId}</span>
              )}
              <span className={styles.commandText}>{cmd.command}</span>
              <FaCopy size={10} className={styles.copyIcon} />
            </div>
          ))
        )}
      </div>

      {/* 底部计数 */}
      <div className={styles.footer}>
        {truncatedCount > 0
          ? `显示最近 ${filteredCommands.length} 条（共 ${totalCount} 条）`
          : `${filteredCommands.length} 条命令`}
      </div>
    </div>
  );
};
