import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { FaCopy, FaPaste } from 'react-icons/fa';
import { ContextMenu, ContextMenuAction } from './ContextMenu';
import 'xterm/css/xterm.css';

interface XtermTerminalProps {
  outputChunks: string[];
  resetToken: number;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  outputChunks,
  resetToken,
  onInput,
  onResize,
}) => {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renderedChunkCountRef = useRef(0);
  const fitFrameRef = useRef<number | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const focusTerminal = () => {
    const terminal = termInstance.current;
    if (!terminal) {
      return;
    }

    requestAnimationFrame(() => {
      terminal.focus();
      const textarea = termRef.current?.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus({ preventScroll: true });
      }
    });
  };

  const closeContextMenu = () => setContextMenuPosition(null);

  const applyTerminalTheme = (terminal: Terminal) => {
    const styles = getComputedStyle(document.documentElement);
    terminal.options.theme = {
      background: styles.getPropertyValue('--terminal-bg').trim() || '#0d1520',
      foreground: styles.getPropertyValue('--terminal-fg').trim() || '#edf6f0',
      cursor: styles.getPropertyValue('--terminal-cursor').trim() || '#7eb99f',
      selectionBackground: styles.getPropertyValue('--terminal-selection').trim() || 'rgba(126, 185, 159, 0.28)',
    };
  };

  const scheduleFit = (addon: FitAddon) => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      addon.fit();
      fitFrameRef.current = null;
    });
  };

  useEffect(() => {
    if (termRef.current && !termInstance.current) {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        scrollback: 5000,
      });
      applyTerminalTheme(terminal);
      const addon = new FitAddon();
      terminal.loadAddon(addon);
      terminal.open(termRef.current);
      termInstance.current = terminal;
      focusTerminal();

      const copySelection = async () => {
        const selection = terminal.getSelection();
        if (!selection) {
          return;
        }
        await navigator.clipboard.writeText(selection);
      };

      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') {
          return true;
        }

        const key = event.key.toLowerCase();
        const isCopyShortcut = terminal.hasSelection() && (
          (isMac && event.metaKey && !event.ctrlKey && !event.altKey && key === 'c') ||
          (!isMac && event.ctrlKey && event.shiftKey && key === 'c')
        );
        const isPasteShortcut =
          (isMac && event.metaKey && !event.ctrlKey && !event.altKey && key === 'v') ||
          (!isMac && event.ctrlKey && event.shiftKey && key === 'v');
        if (isCopyShortcut) {
          void copySelection();
          return false;
        }


        if (isPasteShortcut) {
          void navigator.clipboard.readText().then(text => {
            if (text) {
              terminal.paste(text);
            }
          });
          return false;
        }
        return true;
      });


      terminal.onData(data => {
        onInput(data);
      });

      terminal.onResize(({ cols, rows }) => {
        onResize(cols, rows);
      });

      const resizeObserver = new ResizeObserver(() => {
        scheduleFit(addon);
      });
      resizeObserver.observe(termRef.current);

      setTimeout(() => {
        scheduleFit(addon);
        focusTerminal();
      }, 50);

      return () => {
        resizeObserver.disconnect();
        if (fitFrameRef.current !== null) {
          cancelAnimationFrame(fitFrameRef.current);
          fitFrameRef.current = null;
        }
        if (termInstance.current) {
          termInstance.current.dispose();
          termInstance.current = null;
        }
      };
    }
  }, [onInput, onResize]);

  useEffect(() => {
    if (!contextMenuPosition) {
      return;
    }

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      closeContextMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenuPosition]);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal) {
      return;
    }

    applyTerminalTheme(terminal);

    const observer = new MutationObserver(() => {
      applyTerminalTheme(terminal);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    applyTerminalTheme(terminal);
    renderedChunkCountRef.current = 0;

    if (outputChunks.length > 0) {
      terminal.write(outputChunks.join(''));
      renderedChunkCountRef.current = outputChunks.length;
    }

    focusTerminal();
  }, [resetToken]);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal) {
      return;
    }

    if (outputChunks.length <= renderedChunkCountRef.current) {
      return;
    }

    const nextChunks = outputChunks.slice(renderedChunkCountRef.current);
    terminal.write(nextChunks.join(''));
    renderedChunkCountRef.current = outputChunks.length;
  }, [outputChunks]);

  const contextMenuActions = useMemo<ContextMenuAction[]>(() => [
    {
      label: '复制',
      icon: <FaCopy />,
      action: async () => {
        const selection = termInstance.current?.getSelection();
        if (selection) {
          await navigator.clipboard.writeText(selection);
        }
        focusTerminal();
      },
    },
    {
      label: '粘贴',
      icon: <FaPaste />,
      action: async () => {
        const text = await navigator.clipboard.readText();
        if (text) {
          onInput(text);
        }
        focusTerminal();
      },
    },
  ], [onInput]);

  return (
    <>
      <div
        ref={termRef}
        className="xterm-host"
        style={{ width: 'max-content', minWidth: '100%', height: '100%', overflow: 'hidden' }}
        onMouseDown={() => {
          focusTerminal();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenuPosition({ x: event.clientX, y: event.clientY });
        }}
      />
      {contextMenuPosition && (
        <ContextMenu
          x={contextMenuPosition.x}
          y={contextMenuPosition.y}
          actions={contextMenuActions}
          menuRef={contextMenuRef}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
};
