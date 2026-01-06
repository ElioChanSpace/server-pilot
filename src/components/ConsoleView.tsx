import React from 'react';
import { Server } from '../context/ServerContext';
import { XtermTerminal } from './XtermTerminal';

interface ConsoleViewProps {
  server: Server;
}

export const ConsoleView: React.FC<ConsoleViewProps> = ({ server }) => {
  return (
    <div style={{ height: '100%', width: '100%', backgroundColor: '#000' }}>
      <XtermTerminal sessionId={server.id} />
    </div>
  );
};