import React from 'react';
import { Server } from '../context/ServerContext';
import { FaTimes } from 'react-icons/fa';
import styles from './TabBar.module.css';

interface TabBarProps {
  sessions: Server[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ sessions, currentSessionId, onSelectSession, onCloseSession }) => {
  if (sessions.length === 0) {
    return null; // 如果没有会话，则不渲染任何内容
  }

  return (
    <div className={styles.tabBar}>
      {sessions.map(session => (
        <div
          key={session.id}
          className={styles.tab}
          data-active={session.id === currentSessionId}
          onClick={() => onSelectSession(session.id)}
        >
          <span className={styles.tabTitle}>{session.name}</span>
          <button
            className={styles.closeButton}
            onClick={(e) => {
              e.stopPropagation(); // 防止点击关闭按钮时触发标签页的切换事件
              onCloseSession(session.id);
            }}
            title={`Close ${session.name}`}
          >
            <FaTimes />
          </button>
        </div>
      ))}
    </div>
  );
};