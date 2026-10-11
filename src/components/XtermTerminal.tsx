import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { SearchAddon } from 'xterm-addon-search';
import { FaChevronDown, FaChevronUp, FaCopy, FaPaste, FaSearch, FaTimes } from 'react-icons/fa';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { ContextMenu, ContextMenuAction, isEventInsideContextMenu } from './ContextMenu';
import 'xterm/css/xterm.css';

interface XtermTerminalProps {
  outputChunks: string[];
  /** Cumulative chunks trimmed from the head of outputChunks (memory cap). */
  droppedChunks: number;
  resetToken: number;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  isActive: boolean;
  onFilesDropped: (paths: string[]) => void;
  onCommandExecuted?: (command: string) => void;
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
  prev.onCommandExecuted === next.onCommandExecuted &&
  prev.fontSize === next.fontSize &&
  prev.scrollback === next.scrollback &&
  prev.onFontSizeChange === next.onFontSizeChange &&
  // 非活动会话的累积输出只在激活时一次性补写，因此跳过重渲染。
  (!prev.isActive || prev.outputChunks === next.outputChunks);

/* ============================================================================
 * Shell Integration (OSC 133) 命令边界解析
 * ----------------------------------------------------------------------------
 * 原理：让远程 shell 在关键节点（提示符开始/结束、命令提交、命令结束）主动
 * 输出一个专用的、不会与其他内容混淆的转义序列标记：
 *
 *   ESC ] 133 ; A BEL   新提示符开始 (precmd)
 *   ESC ] 133 ; B BEL   提示符结束，用户输入区开始
 *   ESC ] 133 ; C BEL   命令已提交（回车），命令输出开始 (preexec)
 *   ESC ] 133 ; D ; N BEL   命令输出结束，N 为退出码
 *
 * 前端只需要识别这 4 个固定标记，不需要理解其他任何 ANSI/VT 序列，因此不会
 * 出现"吃错字符数导致内容异常"的问题。命令的真实文本永远从
 * `terminal.buffer.active`（即屏幕上实际渲染的内容）里读取，而不是靠本地
 * 按键流去猜测。
 *
 * 远程 shell 需要配合执行一段初始化脚本（bash/zsh），可参考：
 * https://code.visualstudio.com/docs/terminal/shell-integration#_manual-installation
 * 建议在 SSH/PTY 连接建立成功后自动注入，或引导用户加进 .bashrc / .zshrc。
 * ========================================================================== */

const OSC133_RE = /\x1b\]133;([ABCD])(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;

interface ShellIntegrationHandlers {
  onCommandExecuted?: (command: string) => void;
  /**
   * 从整行文本中剥离 shell 提示符，只保留命令部分。
   * 默认按常见提示符结尾符号（$ # >）粗略切分，建议按你实际连接的 shell
   * 类型自定义，或者后续升级为记录 OSC 133;B 触发时的 cursorX 精确切列。
   */
  stripPrompt?: (line: string) => string;
}

function defaultStripPrompt(line: string): string {
  return line.replace(/^.*?[$#>]\s*/, '').trimEnd();
}

/**
 * 维护 shell integration 的状态机，并在收到远程输出 chunk 时：
 *   1. 正常判断其中是否包含 OSC133 标记
 *   2. 在命中 "C"（命令已提交）标记时，从 terminal.buffer.active 读取
 *      真实渲染出的那一行文本作为命令内容上报
 *
 * 必须在 terminal.write(chunk, callback) 的 callback 里调用本函数，
 * 确保 chunk 已经真正渲染进 buffer 之后再读取，否则会读到旧内容。
 */
function createShellIntegrationTracker(handlers: ShellIntegrationHandlers) {
  const stripPrompt = handlers.stripPrompt ?? defaultStripPrompt;
  let state: 'idle' | 'prompt' | 'input' = 'idle';

  function processChunk(chunk: string, terminal: Terminal) {
    OSC133_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OSC133_RE.exec(chunk)) !== null) {
      const marker = match[1];
      if (marker === 'A') {
        state = 'prompt';
      } else if (marker === 'B') {
        state = 'input';
      } else if (marker === 'C') {
        if (state === 'input') {
          captureCommandLine(terminal);
        }
        state = 'idle';
      } else if (marker === 'D') {
        state = 'idle';
      }
    }
  }

  function captureCommandLine(terminal: Terminal) {
    // 全屏 TUI 程序（vim / htop / less 等）用的是 alternate buffer，
    // 正常 shell integration 标记不会出现在这类场景里，这里多一层保险。
    if (terminal.buffer.active.type === 'alternate') {
      return;
    }

    const buffer = terminal.buffer.active;
    // OSC133;C 标记出现时，光标仍停留在用户刚提交的那一行（回车尚未换行）
    const absY = buffer.baseY + buffer.cursorY;

    // 支持软换行（长命令在窄终端里自动折行）：从当前行往上拼接，
    // 直到遇到一行 isWrapped === false 为止。
    let startY = absY;
    while (startY > 0) {
      const line = buffer.getLine(startY);
      if (!line || !line.isWrapped) break;
      startY--;
    }

    let text = '';
    for (let y = startY; y <= absY; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      text += line.translateToString(false);
    }

    const cmd = stripPrompt(text).trim();
    if (cmd) {
      handlers.onCommandExecuted?.(cmd);
    }
  }

  function reset() {
    state = 'idle';
  }

  return { processChunk, reset };
}

const XtermTerminalComponent: React.FC<XtermTerminalProps> = ({
  outputChunks,
  droppedChunks,
  resetToken,
  onInput,
  onResize,
  isActive,
  onFilesDropped,
  onCommandExecuted,
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
  const lastDroppedChunksRef = useRef(0);
  const fitFrameRef = useRef<number | null>(null);
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const selectionCopyTimerRef = useRef<number | null>(null);
  // 最近一次非空选区快照：右键/焦点变化清掉 xterm 选区后仍可复制
  const lastSelectionRef = useRef<string>("");
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pendingInputRef = useRef('');

  // onCommandExecuted 会随渲染变化，用 ref 存最新值，避免 tracker 闭包过期，
  // 也避免把 onCommandExecuted 变化当成需要重建 tracker / 重挂终端的依赖。
  const onCommandExecutedRef = useRef(onCommandExecuted);
  useEffect(() => {
    onCommandExecutedRef.current = onCommandExecuted;
  }, [onCommandExecuted]);

  // 同理：回调统一走 ref，创建终端的 effect 依赖 []，回调变化不会销毁重建终端。
  const onInputRef = useRef(onInput);
  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  useEffect(() => {
    onFontSizeChangeRef.current = onFontSizeChange;
  }, [onFontSizeChange]);
  const trackLocalInputRef = useRef<(data: string) => void>();

  const shellIntegrationTrackerRef = useRef(
    createShellIntegrationTracker({
      onCommandExecuted: (cmd) => onCommandExecutedRef.current?.(cmd),
    }),
  );

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

  const trackLocalInput = useCallback((data: string) => {
    const text = data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const char of text) {
      if (char === '\r' || char === '\n') {
        const command = pendingInputRef.current.trim();
        pendingInputRef.current = '';
        if (command) {
          onCommandExecutedRef.current?.(command);
        }
      } else if (char === '\u007f') {
        pendingInputRef.current = pendingInputRef.current.slice(0, -1);
      } else if (char === '\x03' || char === '\x04' || char === '\x15') {
        pendingInputRef.current = '';
      } else if (char === '\x17') {
        pendingInputRef.current = pendingInputRef.current.trimEnd().replace(/\S+$/, '');
      } else if (char >= ' ' && char !== '\x7f') {
        pendingInputRef.current += char;
      }
    }
  }, []);
  useEffect(() => {
    trackLocalInputRef.current = trackLocalInput;
  }, [trackLocalInput]);

  const applyTerminalTheme = (terminal: Terminal) => {
    const style = getComputedStyle(document.documentElement);
    const get = (name: string) => style.getPropertyValue(name).trim();
    terminal.options.theme = {
      background: get('--terminal-bg'),
      foreground: get('--terminal-fg'),
      cursor: get('--terminal-cursor'),
      selectionBackground: get('--terminal-selection'),
      black: get('--terminal-black'),
      red: get('--terminal-red'),
      green: get('--terminal-green'),
      yellow: get('--terminal-yellow'),
      blue: get('--terminal-blue'),
      magenta: get('--terminal-magenta'),
      cyan: get('--terminal-cyan'),
      white: get('--terminal-white'),
      brightBlack: get('--terminal-bright-black'),
      brightRed: get('--terminal-bright-red'),
      brightGreen: get('--terminal-bright-green'),
      brightYellow: get('--terminal-bright-yellow'),
      brightBlue: get('--terminal-bright-blue'),
      brightMagenta: get('--terminal-bright-magenta'),
      brightCyan: get('--terminal-bright-cyan'),
      brightWhite: get('--terminal-bright-white'),
    };
  };

  const notifyResize = (terminal: Terminal) => {
    const { cols, rows } = terminal;
    const last = lastSentSizeRef.current;
    if (last && last.cols === cols && last.rows === rows) {
      return;
    }
    lastSentSizeRef.current = { cols, rows };
    onResizeRef.current?.(cols, rows);
  };

  const scheduleFit = (addon: FitAddon, terminal?: Terminal) => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      if (terminal) {
        const beforeCursorY = terminal.buffer.active.cursorY;
        const beforeBaseY = terminal.buffer.active.baseY;
        addon.fit();
        const afterCursorY = terminal.buffer.active.cursorY;
        const afterBaseY = terminal.buffer.active.baseY;
        const cursorDelta = afterCursorY - beforeCursorY;
        const baseDelta = afterBaseY - beforeBaseY;
        if (cursorDelta > 0) {
          terminal.scrollLines(cursorDelta);
        } else if (baseDelta > 0 && cursorDelta === 0) {
          terminal.scrollLines(baseDelta);
        }
        // Keep the remote PTY size in sync with the local terminal.
        notifyResize(terminal);
      } else {
        addon.fit();
      }
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
        // xterm 在 mousedown（含右键）时可能清掉选区 —— 用最近一次非空
        // 选区快照兜底，保证右键复制/快捷键复制始终拿到内容
        const selection =
          terminal.getSelection() ||
          lastSelectionRef.current ||
          window.getSelection()?.toString() ||
          "";
        if (!selection) {
          return;
        }
        try {
          await writeText(selection);
        } catch (err) {
          console.error("[Terminal] 复制到剪贴板失败:", err);
        }
      };

      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') {
          return true;
        }

        const key = event.key.toLowerCase();
        const hasPrimaryModifier = isMac
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey;
        // 不再要求 hasSelection：选区被清（右键/焦点切换）时也能复制
        const isCopyShortcut =
          (hasPrimaryModifier && !event.altKey && key === 'c') ||
          (!isMac && event.ctrlKey && event.shiftKey && key === 'c');
        const isPasteShortcut =
          (hasPrimaryModifier && !event.altKey && key === 'v') ||
          (!isMac && event.ctrlKey && event.shiftKey && key === 'v');
        if (isCopyShortcut) {
          void copySelection();
          return false;
        }

        if (isPasteShortcut) {
          event.preventDefault();
          void readText().then(text => {
            if (text) {
              terminal.paste(text);
            }
          }).catch(() => {});
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
            onFontSizeChangeRef.current?.(1);
            return false;
          }
          if (key === '-') {
            event.preventDefault();
            onFontSizeChangeRef.current?.(-1);
            return false;
          }
          if (key === '0') {
            event.preventDefault();
            onFontSizeChangeRef.current?.(0);
            return false;
          }
        }
        return true;
      });

      terminal.onData(data => {
        // 先把用户输入发给 PTY，再做本地命令跟踪 —— 顺序反了会让
        // 跟踪触发的探测注入（get_terminal_session_directory）抢在
        // 回车之前到达 PTY，把探测文本拼进用户的命令行
        // （表现为 "cd: 参数太多" 且终端状态错乱）
        onInputRef.current?.(data);
        trackLocalInputRef.current?.(data);
      });

      // 选中自动复制到系统剪贴板（防抖，避免拖选过程中高频 IPC）
      terminal.onSelectionChange(() => {
        const current = terminal.getSelection();
        if (current) {
          lastSelectionRef.current = current;
        }
        if (selectionCopyTimerRef.current !== null) {
          window.clearTimeout(selectionCopyTimerRef.current);
        }
        selectionCopyTimerRef.current = window.setTimeout(() => {
          selectionCopyTimerRef.current = null;
          const selection = terminal.getSelection();
          if (selection) {
            void writeText(selection).catch(err => {
              console.error("[Terminal] 选区自动复制失败:", err);
            });
          }
        }, 200);
      });

      terminal.onResize(({ cols, rows }) => {
        onResizeRef.current?.(cols, rows);
      });

      const resizeObserver = new ResizeObserver(() => {
        scheduleFit(addon, terminal);
      });
      resizeObserver.observe(termRef.current);

      const mountTimer = window.setTimeout(() => {
        scheduleFit(addon, terminal);
        focusTerminal();
      }, 50);

      // 监听主题变化
      const themeObserver = new MutationObserver(() => {
        applyTerminalTheme(terminal);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-theme-id'],
      });

      return () => {
        themeObserver.disconnect();
        resizeObserver.disconnect();
        window.clearTimeout(mountTimer);
        if (selectionCopyTimerRef.current !== null) {
          window.clearTimeout(selectionCopyTimerRef.current);
          selectionCopyTimerRef.current = null;
        }
        if (fitFrameRef.current !== null) {
          cancelAnimationFrame(fitFrameRef.current);
          fitFrameRef.current = null;
        }
        if (termInstance.current) {
          termInstance.current.dispose();
          termInstance.current = null;
        }
        // 终端重建后历史输出需要重新回放
        renderedChunkCountRef.current = 0;
        lastSentSizeRef.current = null;
        lastDroppedChunksRef.current = 0;
      };
    }
    // Callbacks are read through refs so the terminal is created exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal) {
      return;
    }

    if (terminal.options.fontSize !== fontSize) {
      terminal.options.fontSize = fontSize;
      const addon = fitAddonRef.current;
      if (addon) {
        scheduleFit(addon, terminal);
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
      if (isEventInsideContextMenu(target)) {
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

    terminal.reset();
    applyTerminalTheme(terminal);
    renderedChunkCountRef.current = 0;
    lastDroppedChunksRef.current = droppedChunks;
    pendingInputRef.current = '';
    shellIntegrationTrackerRef.current.reset();

    if (outputChunks.length > 0) {
      // 只写入最后 scrollback 行，避免 xterm 静默丢弃导致计数脱节
      const maxChunks = scrollback + terminal.rows;
      const startIdx = Math.max(0, outputChunks.length - maxChunks);
      const chunksToWrite = outputChunks.slice(startIdx);
      const joined = chunksToWrite.join('');
      terminal.write(joined, () => {
        // 重放历史输出时同样喂给 tracker，保持状态机与真实内容一致
        shellIntegrationTrackerRef.current.processChunk(joined, terminal);
      });
      renderedChunkCountRef.current = outputChunks.length;
    }

    focusTerminal();
  }, [resetToken]);

  // 窗口重新获得系统焦点时（如编辑器窗口关闭后），把键盘焦点还给终端，
  // 否则按键会掉进无焦点的窗口，表现为"终端卡住/无法输入"。
  useEffect(() => {
    const handleWindowFocus = () => {
      if (isActive && termInstance.current) {
        focusTerminal();
      }
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
    // focusTerminal 仅读取 ref，闭包陈旧无影响
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal || !isActive) {
      return;
    }

    // Re-fit when becoming visible (display:none → visible may need resize)
    const addon = fitAddonRef.current;
    if (addon) {
      scheduleFit(addon, terminal);
    }
  }, [isActive]);

  useEffect(() => {
    const terminal = termInstance.current;
    if (!terminal || !isActive) {
      return;
    }

    // When old chunks were trimmed from the head of the array, the local index
    // of already-rendered chunks shifts — keep the rendered count aligned.
    const droppedDelta = droppedChunks - lastDroppedChunksRef.current;
    if (droppedDelta > 0) {
      renderedChunkCountRef.current = Math.max(
        0,
        renderedChunkCountRef.current - droppedDelta,
      );
      lastDroppedChunksRef.current = droppedChunks;
    }

    if (outputChunks.length <= renderedChunkCountRef.current) {
      return;
    }

    const nextChunks = outputChunks.slice(renderedChunkCountRef.current);
    const joined = nextChunks.join('');

    // 关键点：必须在 write 的回调里再解析 OSC133 标记 / 读取 buffer，
    // 确保这批数据已经真正渲染进 terminal 内部 buffer，否则读到的是
    // 写入前的旧内容，会导致取到上一条命令或空行。
    terminal.write(joined, () => {
      shellIntegrationTrackerRef.current.processChunk(joined, terminal);
    });
    renderedChunkCountRef.current = outputChunks.length;
  }, [isActive, outputChunks, droppedChunks]);

  const contextMenuActions = useMemo<ContextMenuAction[]>(() => [
    {
      label: '复制',
      icon: <FaCopy />,
      action: () => {
        // 选区可能已被 mousedown 清掉，用最近一次快照兜底
        const selection =
          termInstance.current?.getSelection() ||
          lastSelectionRef.current ||
          window.getSelection()?.toString() ||
          "";
        if (selection) {
          void writeText(selection).catch(err => {
            console.error("[Terminal] 右键复制失败:", err);
          });
        }
        focusTerminal();
      },
    },
    {
      label: '粘贴',
      icon: <FaPaste />,
      action: () => {
        const terminal = termInstance.current;
        if (terminal) {
          void readText().then(text => {
            if (text) {
              terminal.paste(text);
            }
          }).catch(() => {});
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
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
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
