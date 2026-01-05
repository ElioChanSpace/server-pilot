import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Server } from '../context/ServerContext';
import { XtermTerminal } from './XtermTerminal';

interface ConsoleViewProps {
  server: Server;
}

export const ConsoleView: React.FC<ConsoleViewProps> = ({ server }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlistenLogs = listen<string>('connection-log', (event) => {
      setLogs(prev => [...prev, event.payload]);
      if (event.payload.includes("PTY attached")) {
        setShowTerminal(true);
      }
    });

    return () => {
      unlistenLogs.then(f => f());
    };
  }, []);

  useEffect(() => {
    // Auto-scroll to the bottom of the log
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (showTerminal) {
    return <XtermTerminal />;
  }

  return (
    <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3>Connecting to {server.name}...</h3>
      <div 
        ref={logContainerRef}
        style={{ 
          flex: 1, 
          backgroundColor: 'rgba(0,0,0,0.3)', 
          marginTop: '16px', 
          borderRadius: '8px', 
          padding: '12px', 
          fontFamily: 'monospace',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {logs.map((log, i) => (
          <div key={i}>{`> ${log}`}</div>
        ))}
      </div>
    </div>
  );
};