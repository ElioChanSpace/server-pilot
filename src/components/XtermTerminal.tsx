import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

export const XtermTerminal: React.FC = () => {
  const termRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (termRef.current && !term.current) {
      const terminal = new Terminal({
        cursorBlink: true,
        theme: {
          background: 'rgba(0,0,0,0.3)',
          foreground: '#f0f0f0',
        },
      });
      
      const addon = new FitAddon();
      terminal.loadAddon(addon);
      
      terminal.open(termRef.current);
      addon.fit();

      terminal.onData(data => {
        invoke('pty_write', { data });
      });

      terminal.onResize(({ cols, rows }) => {
        invoke('pty_resize', { cols, rows });
      });

      term.current = terminal;
      fitAddon.current = addon;

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.current?.fit();
      });
      resizeObserver.observe(termRef.current);

      const unlisten = listen<string>('pty-data', (event) => {
        terminal.write(event.payload);
      });

      return () => {
        resizeObserver.disconnect();
        unlisten.then(f => f());
        terminal.dispose();
      };
    }
  }, []);

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />;
};