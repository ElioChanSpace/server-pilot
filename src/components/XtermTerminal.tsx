import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { SearchAddon } from 'xterm-addon-search';
import { FaChevronDown, FaChevronUp, FaCopy, FaPaste, FaSearch, FaTimes } from 'react-icons/fa';
import { ContextMenu, ContextMenuAction } from './ContextMenu';
import 'xterm/css/xterm.css';

interface XtermTerminalProps {
  outputChunks: string[];
  resetToken: number;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  isActive: boolean;
  onFilesDropped: (paths: string[]) => void;
  fontSize: number;
  scrollback: number;
  onFontSizeChange: (delta: number) => void;
}

const arePropsEqual = (prev: XtermTerminalProps, next: XtermTerminalProps) =>
  prev.resetToken === next.resetToken &&
  prev.isActive === next.isActive &&
  prev.onInput === next.onInput &&
  prev.onResize === next.onResize &&
  prev.onFilesDropped === next.onFilesDropped &&
  prev.fontSize === next.fontSize &&
  prev.scrollback === next.scrollback &&
  prev.onFontSizeChange === next.onFontSizeChange &&
  // 非活动会话的累积输出只在激活时一次性补写，因此跳过重渲染。
  (!prev.isActive || prev.outputChunks === next.outputChunks);

const XtermTerminalComponent: React.FC<XtermTerminalProps> = ({
  outputChunks,
  resetToken,
  onInput,
  onResize,
  isActive,
  onFilesDropped,
  fontSize,
  scrollback,
  onFontSizeChange,
}) => {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renderedChunkCountRef = useRef(0);
  const fitFrameRef = useRef<number | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isPositionInsideTerminal = (x: number, y: number) => {
    const terminalElement = termRef.current;
    if (!terminalElement) {
      return false;
    }

    const rect = terminalElement.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const normalizedX = x / scale;
    const normalizedY = y / scale;

    return (
      normalizedX >= rect.left &&
      normalizedX <= rect.right &&
      normalizedY >= rect.top &&
      normalizedY <= rect.bottom
    );
  };

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
        fontSize,
        scrollback,
      });
      applyTerminalTheme(terminal);
      const addon = new FitAddon();
      terminal.loadAddon(addon);
      const searchAddon = new SearchAddon();
      terminal.loadAddon(searchAddon);
      terminal.open(termRef.current);
      termInstance.current = terminal;
      fitAddonRef.current = addon;
      searchAddonRef.current = searchAddon;
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
        const hasPrimaryModifier = isMac
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey;
        const isCopyShortcut = terminal.hasSelection() && (
          (hasPrimaryModifier && !event.altKey && key === 'c') ||
          (!isMac && event.ctrlKey && event.shiftKey && key === 'c')
        );
        const isPasteShortcut =
          (hasPrimaryModifier && !event.altKey && key === 'v') ||
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

        if (hasPrimaryModifier && !event.altKey && event.shiftKey && key === 'f') {
          event.preventDefault();
          setIsSearchOpen(prev => !prev);
          return false;
        }

        if (!isMac && event.ctrlKey && !event.metaKey && !event.shiftKey) {
          if (key === '=' || key === '+') {
            event.preventDefault();
            onFontSizeChange(1);
            return false;
          }
          if (key === '-') {
            event.preventDefault();
            onFontSizeChange(-1);
            return false;
          }
          if (key === '0') {
            event.preventDefault();
            onFontSizeChange(0);
            return false;
          }
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
  }, [onFontSizeChange, onInput, onResize]);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal) {
      return;
    }

    if (terminal.options.fontSize !== fontSize) {
      terminal.options.fontSize = fontSize;
      const addon = fitAddonRef.current;
      if (addon) {
        scheduleFit(addon);
      }
    }

    if (terminal.options.scrollback !== scrollback) {
      terminal.options.scrollback = scrollback;
    }
  }, [fontSize, scrollback]);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const runSearch = (direction: 'next' | 'previous') => {
    const searchAddon = searchAddonRef.current;
    if (!searchAddon || !searchQuery) {
      return;
    }

    if (direction === 'next') {
      searchAddon.findNext(searchQuery);
    } else {
      searchAddon.findPrevious(searchQuery);
    }
    focusTerminal();
  };

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
    if (!isActive) {
      setIsDropTargetActive(false);
      return;
    }

    let mounted = true;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview().onDragDropEvent((event) => {
      if (!mounted) {
        return;
      }

      if (event.payload.type === 'leave') {
        setIsDropTargetActive(false);
        return;
      }

      const isInsideTerminal = isPositionInsideTerminal(
        event.payload.position.x,
        event.payload.position.y,
      );

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setIsDropTargetActive(isInsideTerminal);
        return;
      }

      if (event.payload.type === 'drop') {
        setIsDropTargetActive(false);
        if (isInsideTerminal && event.payload.paths.length > 0) {
          onFilesDropped(event.payload.paths);
        }
      }
    }).then(dispose => {
      if (!mounted) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      mounted = false;
      setIsDropTargetActive(false);
      if (unlisten) {
        unlisten();
      }
    };
  }, [isActive, onFilesDropped]);

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
    if (!terminal || !isActive) {
      return;
    }

    if (outputChunks.length <= renderedChunkCountRef.current) {
      return;
    }

    const nextChunks = outputChunks.slice(renderedChunkCountRef.current);
    terminal.write(nextChunks.join(''));
    renderedChunkCountRef.current = outputChunks.length;
  }, [isActive, outputChunks]);

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
      >
        {isDropTargetActive && (
          <div className="terminal-drop-overlay">
            <span>释放以上传到当前终端目录</span>
          </div>
        )}
      </div>
      {isSearchOpen && (
        <div className="terminal-search-bar" onMouseDown={event => event.preventDefault()}>
          <FaSearch size={12} className="terminal-search-bar__icon" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            placeholder="搜索终端输出 (Enter 下一个, Shift+Enter 上一个)"
            onChange={event => {
              setSearchQuery(event.target.value);
              if (event.target.value) {
                searchAddonRef.current?.findNext(event.target.value);
              }
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                runSearch(event.shiftKey ? 'previous' : 'next');
              } else if (event.key === 'Escape') {
                setIsSearchOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="terminal-search-bar__btn"
            title="上一个匹配 (Shift+Enter)"
            onClick={() => runSearch('previous')}
          >
            <FaChevronUp size={12} />
          </button>
          <button
            type="button"
            className="terminal-search-bar__btn"
            title="下一个匹配 (Enter)"
            onClick={() => runSearch('next')}
          >
            <FaChevronDown size={12} />
          </button>
          <button
            type="button"
            className="terminal-search-bar__btn"
            title="关闭搜索 (Esc)"
            onClick={() => setIsSearchOpen(false)}
          >
            <FaTimes size={12} />
          </button>
        </div>
      )}
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

export const XtermTerminal = React.memo(XtermTerminalComponent, arePropsEqual);
