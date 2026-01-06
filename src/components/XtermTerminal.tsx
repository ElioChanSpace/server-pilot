import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

interface XtermTerminalProps {
  sessionId: string; // 会话 ID，用于订阅特定事件
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({ sessionId }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);

  useEffect(() => {
    const componentId = `Terminal_${sessionId}`;
    console.log(`${componentId}: useEffect START`);

    let unlisten: UnlistenFn;

    if (termRef.current && !termInstance.current) {
      const terminal = new Terminal({
        cursorBlink: true,
        theme: { background: 'rgba(0,0,0,0.8)', foreground: '#f0f0f0' },
        convertEol: true,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        scrollback: 5000,
      });
      const addon = new FitAddon();
      terminal.loadAddon(addon);
      terminal.open(termRef.current);

      termInstance.current = terminal;

      // --- 关键修复：只订阅自己的事件 ---
      const eventName = `pty-data-${sessionId}`;
      listen<string>(eventName, (event) => {
        terminal.write(event.payload);
      }).then(unlistenFn => {
        console.log(`${componentId}: Attached listener for ${eventName}`);
        unlisten = unlistenFn;
      });

      terminal.onData(data => {
        invoke('pty_write', { serverId: sessionId, data });
      });

      terminal.onResize(({ cols, rows }) => {
        invoke('pty_resize', { serverId: sessionId, rows, cols });
      });

      const resizeObserver = new ResizeObserver(() => {
        addon.fit();
      });
      resizeObserver.observe(termRef.current);

      setTimeout(() => addon.fit(), 50);
    }

    return () => {
      console.log(`${componentId}: Cleanup function running...`);
      if (unlisten) {
        unlisten();
      }
      if (termInstance.current) {
        termInstance.current.dispose();
        termInstance.current = null;
      }
      // 调用后端，确保会话被彻底清理
      invoke('disconnect_server', { serverId: sessionId });
      console.log(`${componentId}: Cleanup finished.`);
    };
  }, [sessionId]); // sessionId 是唯一的依赖

  return <div ref={termRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
};