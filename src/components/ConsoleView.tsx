import React, { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { XtermTerminal } from './XtermTerminal';
import type { TerminalSessionStatus } from '../types/terminal';
import { FaPlug } from 'react-icons/fa';

interface ConsoleViewProps {
  sessionId: string;
  outputChunks: string[];
  resetToken: number;
  isActive: boolean;
  onFilesDropped: (paths: string[]) => void;
  onCommandExecuted?: (command: string) => void;
  fontSize: number;
  scrollback: number;
  status: TerminalSessionStatus;
  onReconnect: () => void;
  onFontSizeChange: (delta: number) => void;
  disconnectMessage?: string | null;
}

const arePropsEqual = (prev: ConsoleViewProps, next: ConsoleViewProps) =>
  prev.sessionId === next.sessionId &&
  prev.resetToken === next.resetToken &&
  prev.isActive === next.isActive &&
  prev.onFilesDropped === next.onFilesDropped &&
  prev.onCommandExecuted === next.onCommandExecuted &&
  prev.fontSize === next.fontSize &&
  prev.scrollback === next.scrollback &&
  prev.status === next.status &&
  prev.onReconnect === next.onReconnect &&
  prev.onFontSizeChange === next.onFontSizeChange &&
  prev.disconnectMessage === next.disconnectMessage &&
  (!prev.isActive || prev.outputChunks === next.outputChunks);

const ConsoleViewComponent: React.FC<ConsoleViewProps> = ({
  sessionId,
  outputChunks,
  resetToken,
  isActive,
  onFilesDropped,
  onCommandExecuted,
  fontSize,
  scrollback,
  status,
  onReconnect,
  onFontSizeChange,
  disconnectMessage,
}) => {
  const handleInput = useCallback((data: string) => {
    void invoke('pty_write', { sessionId, data }).catch(error => {
      console.error('Failed to write PTY input:', error);
    });
  }, [sessionId]);

  const handleResize = useCallback((cols: number, rows: number) => {
    void invoke('pty_resize', { sessionId, rows, cols }).catch(error => {
      console.error('Failed to resize PTY:', error);
    });
  }, [sessionId]);

  return (
    <div
      className="console-shell"
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--terminal-bg)',
        borderTop: '1px solid var(--glass-border)',
      }}
    >
      <XtermTerminal
        outputChunks={outputChunks}
        resetToken={resetToken}
        onInput={handleInput}
        onResize={handleResize}
        isActive={isActive}
        onFilesDropped={onFilesDropped}
        onCommandExecuted={onCommandExecuted}
        fontSize={fontSize}
        scrollback={scrollback}
        onFontSizeChange={onFontSizeChange}
      />
      {status === 'disconnected' && (
        <div className="console-reconnect-overlay">
          <div className="console-reconnect-card">
            <p className="console-reconnect-title">会话已断开</p>
            {disconnectMessage && (
              <p className="console-reconnect-message">{disconnectMessage}</p>
            )}
            <button
              type="button"
              className="console-reconnect-button primary-btn"
              onClick={onReconnect}
            >
              <FaPlug size={12} />
              <span>重新连接</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const ConsoleView = React.memo(ConsoleViewComponent, arePropsEqual);
