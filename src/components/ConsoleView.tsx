import React, { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { XtermTerminal } from './XtermTerminal';

interface ConsoleViewProps {
  sessionId: string;
  outputChunks: string[];
  resetToken: number;
}

export const ConsoleView: React.FC<ConsoleViewProps> = ({
  sessionId,
  outputChunks,
  resetToken,
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
      />
    </div>
  );
};
