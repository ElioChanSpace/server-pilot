import React, { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Server } from '../context/ServerContext';
import { XtermTerminal } from './XtermTerminal';

interface ConsoleViewProps {
  server: Server;
  outputChunks: string[];
  resetToken: number;
}

export const ConsoleView: React.FC<ConsoleViewProps> = ({ server, outputChunks, resetToken }) => {
  const handleInput = useCallback((data: string) => {
    void invoke('pty_write', { serverId: server.id, data }).catch(error => {
      console.error('Failed to write PTY input:', error);
    });
  }, [server.id]);

  const handleResize = useCallback((cols: number, rows: number) => {
    void invoke('pty_resize', { serverId: server.id, rows, cols }).catch(error => {
      console.error('Failed to resize PTY:', error);
    });
  }, [server.id]);

  return (
    <div
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
