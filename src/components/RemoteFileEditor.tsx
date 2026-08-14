import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FaSave, FaSpinner, FaUndo, FaEdit, FaTimes } from "react-icons/fa";
import { getInitialThemeId, getThemeMode } from "../utils/theme-helpers";
import styles from "./RemoteFileEditor.module.css";

interface RemoteFileEditorProps {
  serverId: string;
  filePath: string;
  onClose: () => void | Promise<void>;
  onSaved?: () => void;
}

interface FileContent {
  raw: string;
  html: string;
  language: string;
  lineCount: number;
  fileSize: number;
}

interface HighlightedCode {
  html: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const getBaseName = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
};

// Memoized highlight layer — only re-renders when html changes,
// completely unaffected by isReadOnly, cursor, saveStatus etc.
// forwardRef is required because React 18 memo does not forward refs.
const HighlightLayer = React.memo(
  React.forwardRef<HTMLPreElement, { html: string }>(
    ({ html }, ref) => (
      <pre
        ref={ref}
        className={styles.highlightLayer}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ),
  ),
);
HighlightLayer.displayName = "HighlightLayer";

// Canvas-based line numbers — zero DOM nodes per line,
// redraws only on scroll/lineCount change.
function useCanvasLineNumbers(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  lineCount: number,
  scrollTopRef: React.RefObject<number | null>,
) {
  const dprRef = useRef(window.devicePixelRatio || 1);
  const lineHeightRef = useRef(20.8); // 13px * 1.6 line-height
  const paddingTopRef = useRef(12); // matches textarea/highlight padding
  const fontRef = useRef<string>("");

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const lineHeight = lineHeightRef.current;
    const paddingTop = paddingTopRef.current;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Set canvas resolution to match display
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 字体可缓存（不变），但颜色需每次读取（主题切换时 CSS 变量会变）
    if (!fontRef.current) {
      fontRef.current = `13px 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace`;
    }
    ctx.font = fontRef.current;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("color").trim() || "#585b70";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const scrollTop = Math.max(0, scrollTopRef.current ?? 0);
    const visibleStart = Math.max(0, Math.floor(scrollTop / lineHeight));
    const visibleEnd = Math.min(lineCount, visibleStart + Math.ceil(h / lineHeight) + 1);
    const padRight = 8;

    // Draw only visible lines
    for (let i = visibleStart; i < visibleEnd; i++) {
      // paddingTop offsets line 1 to the same y as textarea text content
      const y = paddingTop + (i * lineHeight - scrollTop) + lineHeight / 2;
      // Only draw if within canvas bounds
      if (y >= 0 && y <= h) {
        ctx.fillText(String(i + 1), w - padRight, y);
      }
    }
  }, [canvasRef, lineCount, scrollTopRef]);

  return draw;
}

export const RemoteFileEditor: React.FC<RemoteFileEditorProps> = ({
  serverId,
  filePath,
  onClose,
  onSaved,
}) => {
  const [content, setContent] = useState<string>("");
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [language, setLanguage] = useState<string>("");
  const [lineCount, setLineCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const themeMode = useMemo(() => getThemeMode(getInitialThemeId()), []);
  const [isReadOnly, setIsReadOnly] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollTopRef = useRef<number>(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 清理所有未完成的 timer
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const drawLineNumbers = useCanvasLineNumbers(canvasRef, lineCount, scrollTopRef);

  // Load file content
  const loadFile = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await invoke<FileContent>("get_file_content", {
        serverId,
        path: filePath,
        themeMode: themeMode,
      });

      if (!mountedRef.current) return;
      setContent(result.raw);
      setHighlightedHtml(result.html);
      setLanguage(result.language);
      setLineCount(result.lineCount);
      originalContentRef.current = result.raw;
      setIsDirty(false);
      void invoke("log_frontend_action", { module: "Editor", message: `加载文件成功: ${filePath} (${result.language}, ${result.lineCount} 行)` });
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = typeof err === "string" ? err : "加载文件失败";
      setError(msg);
      void invoke("log_frontend_action", { module: "Editor", message: `加载文件失败: ${filePath} — ${msg}` });
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [serverId, filePath, themeMode]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  // Redraw canvas line numbers when lineCount changes
  useEffect(() => {
    const t0 = performance.now();
    drawLineNumbers();
    console.log("[Editor] drawLineNumbers (lineCount:", lineCount, ") took", (performance.now() - t0).toFixed(1), "ms");
  }, [lineCount, drawLineNumbers]);

  // Debounced re-highlight
  const scheduleHighlight = useCallback(
    (code: string, lang: string) => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }

      highlightTimerRef.current = setTimeout(async () => {
        try {
          const result = await invoke<HighlightedCode>("highlight_code", {
            code,
            language: lang,
            themeMode: themeMode,
          });
          if (mountedRef.current) setHighlightedHtml(result.html);
        } catch {
          // non-fatal
        }
      }, 300);
    },
    [themeMode],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Handle text input
  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setContent(value);
      setIsDirty(value !== originalContentRef.current);
      setLineCount(value.split("\n").length);
      scheduleHighlight(value, language);
    },
    [language, scheduleHighlight],
  );

  // Sync scroll between textarea, highlight canvas, and line numbers canvas.
  // Uses transform instead of scrollTop for the highlight layer — more reliable
  // with nested <pre> elements and avoids scrollHeight mismatch issues.
  const rafPendingRef = useRef(false);
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;

    if (textarea && highlight) {
      highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    }

    if (textarea) {
      scrollTopRef.current = textarea.scrollTop;
      // 合并同帧多次 scroll 事件，每帧只重绘一次 canvas
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          rafPendingRef.current = false;
          drawLineNumbers();
        });
      }
    }
  }, [drawLineNumbers]);

  // Track cursor position
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const textBefore = content.substring(0, pos);
    const lines = textBefore.split("\n");
    setCursorLine(lines.length);
    setCursorCol(lines[lines.length - 1].length + 1);
  }, [content]);

  // Save file
  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    void invoke("log_frontend_action", { module: "Editor", message: `保存文件: ${filePath}` });
    try {
      await invoke<string>("save_remote_file", {
        serverId,
        path: filePath,
        content,
      });
      if (!mountedRef.current) return;
      originalContentRef.current = content;
      setIsDirty(false);
      setSaveStatus("saved");
      onSaved?.();
      void emit("editor-file-saved", { serverId, filePath });
      void invoke("log_frontend_action", { module: "Editor", message: `保存成功: ${filePath}` });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => { if (mountedRef.current) setSaveStatus("idle"); }, 2000);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = typeof err === "string" ? err : "保存失败";
      setSaveStatus("error");
      setError(msg);
      void invoke("log_frontend_action", { module: "Editor", message: `保存失败: ${filePath} — ${msg}` });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => { if (mountedRef.current) setSaveStatus("idle"); }, 3000);
    }
  }, [serverId, filePath, content, onSaved]);

  // Reset to original content
  const handleReset = useCallback(() => {
    const original = originalContentRef.current;
    setContent(original);
    setIsDirty(false);
    setLineCount(original.split("\n").length);
    scheduleHighlight(original, language);
    void invoke("log_frontend_action", { module: "Editor", message: `重置内容: ${filePath}` });
  }, [language, scheduleHighlight, filePath]);

  // Toggle edit mode — only flips isReadOnly, no DOM rebuild
  const handleToggleEdit = useCallback(() => {
    let nextReadOnly = false;
    setIsReadOnly((prev) => {
      nextReadOnly = !prev;
      return nextReadOnly;
    });
    // Log after state update (not inside updater — side effects in updater cause Windows jank)
    void invoke("log_frontend_action", { module: "Editor", message: `切换模式: ${filePath} → ${nextReadOnly ? "只读" : "编辑"}` });
    // Double rAF: first frame applies style changes, second frame focuses
    // after layout/paint completes. Prevents jank on Windows WebView2.
    if (!nextReadOnly) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(0, 0);
          }
        });
      });
    }
  }, [filePath]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const isPrimary = isMac ? event.metaKey : event.ctrlKey;

      if (isPrimary && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (isDirty && saveStatus !== "saving") {
          void handleSave();
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, saveStatus, handleSave, onClose]);

  // Handle tab key for indentation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Tab") {
        event.preventDefault();
        const textarea = event.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const newValue = value.substring(0, start) + "\t" + value.substring(end);
        setContent(newValue);
        setIsDirty(newValue !== originalContentRef.current);
        scheduleHighlight(newValue, language);

        requestAnimationFrame(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = start + 1;
        });
      }
    },
    [language, scheduleHighlight],
  );

  const getStatusText = () => {
    switch (saveStatus) {
      case "saving":
        return "保存中...";
      case "saved":
        return "已保存";
      case "error":
        return "保存失败";
      default:
        return isDirty ? "已修改" : "";
    }
  };

  const getStatusClass = () => {
    switch (saveStatus) {
      case "saving":
        return "";
      case "saved":
        return styles.statusSaved;
      case "error":
        return styles.statusError;
      default:
        return isDirty ? styles.statusModified : "";
    }
  };

  // Handle title bar drag
  const handleTitleBarMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof SVGElement) {
      return;
    }
    const t0 = performance.now();
    console.log("[Editor] startDragging begin");
    try {
      await getCurrentWindow().startDragging();
      console.log("[Editor] startDragging done in", (performance.now() - t0).toFixed(1), "ms");
    } catch (err) {
      console.error("[Editor] startDragging failed after", (performance.now() - t0).toFixed(1), "ms:", err);
    }
  }, []);

  return (
    <div className={styles.editorOverlay}>
      <div
        className={styles.toolbar}
        data-tauri-drag-region
        onMouseDown={(e) => void handleTitleBarMouseDown(e)}
      >
        <div className={styles.toolbarLeft}>
          <span className={styles.fileName}>{getBaseName(filePath)}</span>
          {language && <span className={styles.langBadge}>{language}</span>}
        </div>
        <div className={styles.toolbarRight}>
          <button
            type="button"
            className={`${styles.toolbarButton} ${isReadOnly ? styles.primary : ""}`}
            onClick={handleToggleEdit}
          >
            <FaEdit />
            <span>{isReadOnly ? "编辑" : "只读"}</span>
          </button>
          {!isReadOnly && (
            <>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={handleReset}
                disabled={!isDirty}
                title="重置为原始内容"
              >
                <FaUndo />
                <span>重置</span>
              </button>
              <button
                type="button"
                className={`${styles.toolbarButton} ${styles.primary}`}
                onClick={() => void handleSave()}
                disabled={!isDirty || saveStatus === "saving"}
              >
                {saveStatus === "saving" ? <FaSpinner /> : <FaSave />}
                <span>保存</span>
              </button>
            </>
          )}
          <div className={styles.separator} />
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => {
              void invoke("log_frontend_action", { module: "Editor", message: `关闭编辑器: ${filePath}` });
              void onClose();
            }}
            title="关闭 (ESC)"
          >
            <FaTimes />
            <span>关闭</span>
          </button>
        </div>
      </div>

      <div className={styles.editorBody} data-readonly={isReadOnly}>
        {isLoading ? (
          <div className={styles.loading}>正在加载文件...</div>
        ) : error ? (
          <div className={styles.error}>
            <span>{error}</span>
            <button type="button" className={styles.errorRetry} onClick={() => {
              void invoke("log_frontend_action", { module: "Editor", message: `重试加载文件: ${filePath}` });
              void loadFile();
            }}>
              重试
            </button>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className={styles.lineNumbersCanvas}
            />
            <div className={styles.editorContent} data-readonly={isReadOnly} data-theme={themeMode}>
              <HighlightLayer html={highlightedHtml} ref={highlightRef} />
              <textarea
                ref={textareaRef}
                className={styles.textareaLayer}
                value={content}
                readOnly={isReadOnly}
                onChange={handleInput}
                onScroll={handleScroll}
                onSelect={handleSelect}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </>
        )}
      </div>

      <div className={styles.statusBar}>
        {!isReadOnly && (
          <span className={styles.statusItem}>
            行 {cursorLine}, 列 {cursorCol}
          </span>
        )}
        <span className={styles.statusItem}>{lineCount} 行</span>
        {getStatusText() && (
          <span className={`${styles.statusItem} ${getStatusClass()}`}>
            {getStatusText()}
          </span>
        )}
      </div>
    </div>
  );
};
