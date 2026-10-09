import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  FaSave, FaSpinner, FaEdit, FaTimes, FaLock, FaSearch, FaChevronUp,
  FaChevronDown, FaRedo, FaExclamationTriangle,
} from "react-icons/fa";
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

interface RemoteFileStat {
  size: number;
  mtime: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface MatchRange {
  start: number;
  end: number;
  line: number;
  col: number;
  endCol: number;
}

const getBaseName = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
};

const formatSavedTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 字体度量（等宽）：用于查找匹配的高亮矩形定位
const LINE_HEIGHT = 20.8; // 13px * 1.6
const PAD = 12;
const FONT = "13px 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace";

function measureCharWidth(): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 7.8;
  ctx.font = FONT;
  return ctx.measureText("M").width;
}

/** 计算全部匹配位置（行/列），供高亮矩形与导航使用 */
function findMatches(content: string, query: string, caseSensitive: boolean): MatchRange[] {
  if (!query) return [];
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: MatchRange[] = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineStarts.push(i + 1);
  }
  let idx = haystack.indexOf(needle);
  while (idx !== -1 && matches.length < 5000) {
    // 定位行列（二分可优化，行数有限先线性）
    let line = 0;
    for (let l = lineStarts.length - 1; l >= 0; l--) {
      if (lineStarts[l] <= idx) {
        line = l;
        break;
      }
    }
    matches.push({
      start: idx,
      end: idx + query.length,
      line,
      col: idx - lineStarts[line],
      endCol: idx + query.length - lineStarts[line],
    });
    idx = haystack.indexOf(needle, idx + Math.max(1, query.length));
  }
  return matches;
}

// Memoized highlight layer — only re-renders when html changes
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

// Canvas-based line numbers
function useCanvasLineNumbers(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  lineCount: number,
  scrollTopRef: React.RefObject<number | null>,
) {
  const dprRef = useRef(window.devicePixelRatio || 1);
  const lineHeightRef = useRef(LINE_HEIGHT);
  const paddingTopRef = useRef(PAD);
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

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!fontRef.current) {
      fontRef.current = FONT;
    }
    ctx.font = fontRef.current;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("color").trim() || "#585b70";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const scrollTop = Math.max(0, scrollTopRef.current ?? 0);
    const visibleStart = Math.max(0, Math.floor(scrollTop / lineHeight));
    const visibleEnd = Math.min(lineCount, visibleStart + Math.ceil(h / lineHeight) + 1);
    const padRight = 8;

    for (let i = visibleStart; i < visibleEnd; i++) {
      const y = paddingTop + (i * lineHeight - scrollTop) + lineHeight / 2;
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
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [eol, setEol] = useState<"LF" | "CRLF">("LF");
  const [closing, setClosing] = useState(false);
  const themeMode = useMemo(() => getThemeMode(getInitialThemeId()), []);
  // I-1: 打开即编辑；只读为显式态（可通过工具栏切换）
  const [isReadOnly, setIsReadOnly] = useState(false);

  // 查找/替换 (I-3)
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);

  // 关闭/冲突对话框 (I-6 / I-7)
  const [closeDialog, setCloseDialog] = useState<null | "dirty" | "saveFailed">(null);
  const [conflict, setConflict] = useState<null | RemoteFileStat>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const scrollTopRef = useRef<number>(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef<string>("");
  const contentRef = useRef<string>("");
  const fileStatRef = useRef<RemoteFileStat | null>(null);
  const forceCloseRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const charWidthRef = useRef(0);
  const mountedRef = useRef(true);

  const applyContent = useCallback((value: string) => {
    contentRef.current = value;
    setContent(value);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    charWidthRef.current = measureCharWidth();
    return () => {
      mountedRef.current = false;
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  const drawLineNumbers = useCanvasLineNumbers(canvasRef, lineCount, scrollTopRef);

  const matches = useMemo(
    () => findMatches(content, findQuery, caseSensitive),
    [content, findQuery, caseSensitive],
  );

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
      applyContent(result.raw);
      setHighlightedHtml(result.html);
      setLanguage(result.language);
      setLineCount(result.lineCount);
      setEol(result.raw.includes("\r\n") ? "CRLF" : "LF");
      originalContentRef.current = result.raw;
      setIsDirty(false);
      // 冲突检测基线
      invoke<RemoteFileStat>("stat_remote_file", { serverId, path: filePath })
        .then(stat => { if (mountedRef.current) fileStatRef.current = stat; })
        .catch(() => { fileStatRef.current = null; });
      void invoke("log_frontend_action", { module: "Editor", message: `加载文件成功: ${filePath} (${result.language}, ${result.lineCount} 行)` });
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = typeof err === "string" ? err : "加载文件失败";
      setError(msg);
      void invoke("log_frontend_action", { module: "Editor", message: `加载文件失败: ${filePath} — ${msg}` });
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [serverId, filePath, themeMode, applyContent]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  // Redraw canvas line numbers when lineCount changes
  useEffect(() => {
    drawLineNumbers();
  }, [lineCount, drawLineNumbers]);

  // Debounced re-highlight
  const scheduleHighlight = useCallback(
    (code: string, lang: string) => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(() => {
        invoke<string>("highlight_code", { code, language: lang, themeMode })
          .then(html => {
            if (mountedRef.current) {
              setHighlightedHtml(html);
            }
          })
          .catch(() => {});
      }, 250);
    },
    [themeMode],
  );

  // Handle text input
  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      applyContent(value);
      setIsDirty(value !== originalContentRef.current);
      setLineCount(value.split("\n").length);
      scheduleHighlight(value, language);
    },
    [language, scheduleHighlight, applyContent],
  );

  // Sync scroll between textarea, highlight canvas, and line numbers canvas.
  const rafPendingRef = useRef(false);
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;

    if (textarea && highlight) {
      highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    }

    if (textarea) {
      scrollTopRef.current = textarea.scrollTop;
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          rafPendingRef.current = false;
          drawLineNumbers();
        });
      }
    }
  }, [drawLineNumbers]);

  // Track cursor position (I-8 状态栏)
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const textBefore = contentRef.current.substring(0, pos);
    const lines = textBefore.split("\n");
    setCursorLine(lines.length);
    setCursorCol(lines[lines.length - 1].length + 1);
  }, []);

  // ── 保存流（I-5 状态 / I-7 冲突检测） ──
  // 先于 persistSave 定义：persistSave 成功后需继续"保存并关闭"流程
  const animateClose = useCallback(() => {
    if (forceCloseRef.current) return;
    forceCloseRef.current = true;
    setClosing(true);
    void emit("editor-closed", { serverId, filePath });
    setTimeout(() => {
      void Promise.resolve(onClose()).catch(() => {
        void getCurrentWindow().close().catch(() => {});
      });
    }, 150);
  }, [serverId, filePath, onClose]);

  const persistSave = useCallback(async (force = false): Promise<boolean> => {
    const snapshot = contentRef.current;
    setSaveStatus("saving");
    setError(null);
    void invoke("log_frontend_action", { module: "Editor", message: `保存文件: ${filePath}` });

    // 冲突检测：远端在加载后被改动过则先询问
    if (!force) {
      try {
        const stat = await invoke<RemoteFileStat>("stat_remote_file", { serverId, path: filePath });
        const base = fileStatRef.current;
        if (base && (stat.size !== base.size || stat.mtime !== base.mtime)) {
          setSaveStatus("idle");
          setConflict(stat);
          return false;
        }
      } catch { /* stat 失败不阻塞保存 */ }
    }

    try {
      await invoke<string>("save_remote_file", {
        serverId,
        path: filePath,
        content: snapshot,
      });
      if (!mountedRef.current) return true;
      originalContentRef.current = snapshot;
      setIsDirty(contentRef.current !== snapshot);
      setLastSavedAt(Date.now());
      setSaveStatus("saved");
      onSaved?.();
      void emit("editor-file-saved", { serverId, filePath });
      void invoke("log_frontend_action", { module: "Editor", message: `保存成功: ${filePath}` });
      // 更新冲突检测基线
      invoke<RemoteFileStat>("stat_remote_file", { serverId, path: filePath })
        .then(stat => { if (mountedRef.current) fileStatRef.current = stat; })
        .catch(() => {});
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => { if (mountedRef.current) setSaveStatus("idle"); }, 2600);
      // 关闭意图保持：从"保存并关闭"流进来的，保存成功后继续关闭
      if (pendingCloseRef.current) {
        pendingCloseRef.current = false;
        animateClose();
      }
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      const msg = typeof err === "string" ? err : "保存失败";
      setSaveStatus("error");
      setError(msg);
      void invoke("log_frontend_action", { module: "Editor", message: `保存失败: ${filePath} — ${msg}` });
      // 从"保存并关闭"流进来的：失败则提示导出/强关
      if (pendingCloseRef.current) {
        pendingCloseRef.current = false;
        setCloseDialog("saveFailed");
      }
      return false;
    }
  }, [serverId, filePath, onSaved, animateClose]);

  const handleSave = useCallback(() => { void persistSave(); }, [persistSave]);

  // 导出到本地（保存失败时的降级出口）
  const handleExportLocal = useCallback(async () => {
    try {
      const target = await saveDialog({
        title: "导出到本地",
        defaultPath: getBaseName(filePath),
      });
      if (!target) return;
      await writeTextFile(target, contentRef.current);
      setError(null);
    } catch (err) {
      setError(`导出失败: ${typeof err === "string" ? err : String(err)}`);
    }
  }, [filePath]);

  // ── 关闭流（I-6 三态确认） ──
  const requestClose = useCallback(() => {
    if (saveStatus === "saving") return;
    if (contentRef.current !== originalContentRef.current) {
      setCloseDialog("dirty");
      return;
    }
    animateClose();
  }, [saveStatus, animateClose]);

  // 统一关闭卡口：OS 关闭/⌘W/按钮全部走这里（I-2/4/6）
  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    void win.onCloseRequested(event => {
      if (forceCloseRef.current) return; // 允许关闭
      event.preventDefault();
      if (disposed) return;
      if (saveStatus === "saving") return;
      if (contentRef.current !== originalContentRef.current) {
        setCloseDialog("dirty");
      } else {
        animateClose();
      }
    });
    return () => {
      disposed = true;
    };
  }, [saveStatus, animateClose]);

  // ── 查找导航 (I-3) ──
  const scrollToMatch = useCallback((m: MatchRange) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(m.start, m.end);
    const targetTop = PAD + m.line * LINE_HEIGHT - textarea.clientHeight / 2;
    textarea.scrollTop = Math.max(0, targetTop);
    handleScroll();
    handleSelect();
  }, [handleScroll, handleSelect]);

  const gotoMatch = useCallback((delta: number) => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    scrollToMatch(matches[next]);
  }, [matches, matchIndex, scrollToMatch]);

  const openFind = useCallback((withReplace: boolean) => {
    setFindOpen(true);
    setShowReplace(withReplace);
    const textarea = textareaRef.current;
    if (textarea) {
      const sel = contentRef.current.substring(textarea.selectionStart, textarea.selectionEnd);
      if (sel && sel.length < 200 && !sel.includes("\n")) {
        setFindQuery(sel);
      }
    }
    setTimeout(() => findInputRef.current?.focus(), 30);
  }, []);

  const replaceCurrent = useCallback(() => {
    if (matches.length === 0) return;
    const m = matches[Math.min(matchIndex, matches.length - 1)];
    const value = contentRef.current;
    const next = value.slice(0, m.start) + replaceQuery + value.slice(m.end);
    applyContent(next);
    setIsDirty(next !== originalContentRef.current);
    setLineCount(next.split("\n").length);
    scheduleHighlight(next, language);
  }, [matches, matchIndex, replaceQuery, applyContent, language, scheduleHighlight]);

  const replaceAll = useCallback(() => {
    if (matches.length === 0) return;
    let value = contentRef.current;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      value = value.slice(0, m.start) + replaceQuery + value.slice(m.end);
    }
    applyContent(value);
    setIsDirty(value !== originalContentRef.current);
    setLineCount(value.split("\n").length);
    scheduleHighlight(value, language);
    setMatchIndex(0);
  }, [matches, replaceQuery, applyContent, language, scheduleHighlight]);

  // ── 快捷键 (I-2 / I-4)：ESC 分层语义；⌘S/⌘F/⌘H 拦截浏览器默认 ──
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const primary = isMac ? event.metaKey : event.ctrlKey;

      if (primary && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (saveStatus !== "saving") void persistSave();
        return;
      }
      if (primary && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind(false);
        return;
      }
      if (primary && event.key.toLowerCase() === "h") {
        event.preventDefault();
        openFind(true);
        return;
      }
      if (event.key === "Escape") {
        // ① 关查找条 → ② 清选区 → ③ 无动作（绝不直接关窗）
        if (findOpen) {
          event.preventDefault();
          setFindOpen(false);
          textareaRef.current?.focus();
          return;
        }
        const textarea = textareaRef.current;
        if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
          event.preventDefault();
          const pos = textarea.selectionEnd;
          textarea.setSelectionRange(pos, pos);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveStatus, persistSave, openFind, findOpen]);

  // Reset to original content
  const handleReset = useCallback(() => {
    const original = originalContentRef.current;
    applyContent(original);
    setIsDirty(false);
    setLineCount(original.split("\n").length);
    scheduleHighlight(original, language);
    void invoke("log_frontend_action", { module: "Editor", message: `重置内容: ${filePath}` });
  }, [language, scheduleHighlight, filePath, applyContent]);

  // Toggle read-only
  const handleToggleEdit = useCallback(() => {
    setIsReadOnly(prev => {
      const next = !prev;
      if (next) {
        setTimeout(() => textareaRef.current?.blur(), 0);
      } else {
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
      return next;
    });
    void invoke("log_frontend_action", { module: "Editor", message: `切换模式: ${filePath}` });
  }, [filePath]);

  // Tab key for indentation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Tab") {
        event.preventDefault();
        const textarea = event.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const newValue = value.substring(0, start) + "\t" + value.substring(end);
        applyContent(newValue);
        setIsDirty(newValue !== originalContentRef.current);

        requestAnimationFrame(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = start + 1;
        });
      }
    },
    [applyContent],
  );

  const handleTitleBarMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof SVGElement) {
      return;
    }
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error("[Editor] startDragging failed:", err);
    }
  }, []);

  // 查找高亮矩形（仅可见区域，等宽字体定位）
  const matchRects = useMemo(() => {
    if (!findOpen || matches.length === 0) return [];
    const cw = charWidthRef.current || 7.8;
    const scrollTop = scrollTopRef.current;
    const viewportH = textareaRef.current?.clientHeight ?? 600;
    return matches
      .filter(m => {
        const y = PAD + m.line * LINE_HEIGHT - scrollTop;
        return y > -LINE_HEIGHT && y < viewportH;
      })
      .map((m, i) => ({
        key: `${m.start}-${i}`,
        top: PAD + m.line * LINE_HEIGHT - scrollTop,
        left: PAD + m.col * cw,
        width: Math.max(cw, (m.endCol - m.col) * cw),
        active: matches[matchIndex]?.start === m.start,
      }));
  }, [findOpen, matches, matchIndex, content, cursorLine]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isDirty;
  const fileName = getBaseName(filePath);

  return (
    <div className={styles.editorOverlay} data-mode={isReadOnly ? "readonly" : "editing"} data-closing={closing || undefined}>
      <div
        className={styles.toolbar}
        onMouseDown={handleTitleBarMouseDown}
      >
        <div className={styles.toolbarLeft}>
          <div className={styles.fileBadge}>
            {!isReadOnly && <span className={styles.accentBar} />}
            {isReadOnly && <FaLock size={10} className={styles.lockIcon} />}
            <span className={styles.fileName} title={filePath}>{fileName}</span>
            {dirty && <span className={styles.dirtyDot} title="有未保存的修改" />}
          </div>
          <span className={styles.langBadge}>{language || "text"}</span>
          <span className={`${styles.modePill} ${isReadOnly ? styles.modeReadonly : styles.modeEditing}`}>
            {isReadOnly ? "只读" : "编辑中"}
          </span>
        </div>
        <div className={styles.toolbarRight}>
          {!isReadOnly && (
            <>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={handleReset}
                disabled={!dirty || saveStatus === "saving"}
                title="重置为原始内容"
              >
                <FaRedo size={11} /> 重置
              </button>
              <button
                type="button"
                className={`${styles.toolbarButton} ${styles.primary}`}
                onClick={handleSave}
                disabled={!dirty || saveStatus === "saving"}
                title="保存 (⌘S)"
              >
                {saveStatus === "saving" ? <FaSpinner size={11} className={styles.spin} /> : <FaSave size={11} />}
                <span>{saveStatus === "saving" ? "保存中…" : "保存"}</span>
              </button>
            </>
          )}
          <button
            type="button"
            className={`${styles.toolbarButton} ${isReadOnly ? styles.toggleOn : ""}`}
            onClick={handleToggleEdit}
            title={isReadOnly ? "进入编辑模式" : "切换为只读"}
          >
            <FaEdit size={11} /> {isReadOnly ? "编辑" : "只读"}
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={() => openFind(false)}
            title="查找 (⌘F)"
          >
            <FaSearch size={11} />
          </button>
          <button type="button" className={styles.closeButton} onClick={requestClose} title="关闭">
            <FaTimes size={12} />
          </button>
        </div>
      </div>

      <div className={styles.editorBody} data-readonly={isReadOnly}>
        <canvas ref={canvasRef} className={styles.lineNumbersCanvas} />
        <div className={styles.editorContent} data-readonly={isReadOnly}>
          <div className={styles.matchLayer} aria-hidden>
            {matchRects.map(r => (
              <div
                key={r.key}
                className={`${styles.matchRect} ${r.active ? styles.matchActive : ""}`}
                style={{ top: r.top, left: r.left, width: r.width }}
              />
            ))}
          </div>
          <HighlightLayer html={highlightedHtml} ref={highlightRef} />
          <textarea
            ref={textareaRef}
            className={styles.textareaLayer}
            value={content}
            onChange={handleInput}
            onScroll={handleScroll}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            readOnly={isReadOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={isLoading ? "" : "输入内容…"}
          />
        </div>

        {/* 查找/替换条 (I-3) */}
        {findOpen && (
          <div className={styles.findBar}>
            <div className={styles.findRow}>
              <FaSearch size={10} className={styles.findIcon} />
              <input
                ref={findInputRef}
                className={styles.findInput}
                value={findQuery}
                placeholder="查找"
                onChange={e => { setFindQuery(e.target.value); setMatchIndex(0); }}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
                  if (e.key === "Escape") { e.preventDefault(); setFindOpen(false); textareaRef.current?.focus(); }
                }}
              />
              <span className={styles.findCount}>
                {matches.length === 0 ? "无结果" : `${Math.min(matchIndex + 1, matches.length)}/${matches.length}`}
              </span>
              <button type="button" className={styles.findBtn} title="上一个 (⇧Enter)" onClick={() => gotoMatch(-1)} disabled={matches.length === 0}>
                <FaChevronUp size={10} />
              </button>
              <button type="button" className={styles.findBtn} title="下一个 (Enter)" onClick={() => gotoMatch(1)} disabled={matches.length === 0}>
                <FaChevronDown size={10} />
              </button>
              <button
                type="button"
                className={`${styles.findBtn} ${caseSensitive ? styles.findBtnActive : ""}`}
                title="区分大小写"
                onClick={() => { setCaseSensitive(prev => !prev); setMatchIndex(0); }}
              >
                Aa
              </button>
              <button type="button" className={styles.findBtn} title={showReplace ? "收起替换" : "替换 (⌘H)"} onClick={() => setShowReplace(prev => !prev)}>
                ≡
              </button>
              <button type="button" className={styles.findBtn} title="关闭" onClick={() => { setFindOpen(false); textareaRef.current?.focus(); }}>
                <FaTimes size={10} />
              </button>
            </div>
            {showReplace && (
              <div className={styles.findRow}>
                <input
                  className={styles.findInput}
                  value={replaceQuery}
                  placeholder="替换为"
                  onChange={e => setReplaceQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setFindOpen(false); } }}
                />
                <button type="button" className={styles.findBtnWide} onClick={replaceCurrent} disabled={matches.length === 0 || isReadOnly}>
                  替换
                </button>
                <button type="button" className={styles.findBtnWide} onClick={replaceAll} disabled={matches.length === 0 || isReadOnly}>
                  全部替换
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.statusBar}>
        <span className={styles.statusPath} title={filePath}>{filePath}</span>
        <div className={styles.statusRight}>
          {saveStatus === "error" && (
            <button type="button" className={styles.retryInline} onClick={handleSave}>
              <FaExclamationTriangle size={10} /> 保存失败 · 重试
            </button>
          )}
          <span className={`${styles.statusPill} ${saveStatus === "saving" ? styles.pillSaving : saveStatus === "saved" ? styles.pillSaved : saveStatus === "error" ? styles.pillError : dirty ? styles.pillDirty : styles.pillIdle}`}>
            {saveStatus === "saving" && <><FaSpinner size={9} className={styles.spin} /> 保存中</>}
            {saveStatus === "saved" && <>✓ 已同步{lastSavedAt ? ` ${formatSavedTime(lastSavedAt)}` : ""}</>}
            {saveStatus === "error" && <>✗ 同步失败</>}
            {saveStatus === "idle" && (dirty ? "● 已修改" : "已同步")}
          </span>
          <span className={styles.statusItem}>{eol}</span>
          <span className={styles.statusItem}>UTF-8</span>
          <span className={styles.statusItem}>{cursorLine}:{cursorCol}</span>
        </div>
      </div>

      {/* 关闭三态确认 (I-6) */}
      {closeDialog && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>
              {closeDialog === "saveFailed" ? "保存失败，仍要关闭吗？" : "文件有未保存的修改"}
            </div>
            <div className={styles.dialogText}>
              {closeDialog === "saveFailed"
                ? "建议先导出到本地保留副本，避免修改丢失。"
                : `${fileName} 的修改尚未保存到远端。`}
            </div>
            <div className={styles.dialogActions}>
              {closeDialog === "dirty" ? (
                <>
                  <button type="button" className={styles.dialogPrimary} onClick={() => {
                    setCloseDialog(null);
                    pendingCloseRef.current = true;
                    void persistSave();
                  }}>保存并关闭</button>
                  <button type="button" className={styles.dialogDanger} onClick={() => { setCloseDialog(null); animateClose(); }}>
                    放弃修改
                  </button>
                  <button type="button" className={styles.dialogGhost} onClick={() => setCloseDialog(null)}>取消</button>
                </>
              ) : (
                <>
                  <button type="button" className={styles.dialogPrimary} onClick={async () => {
                    setCloseDialog(null);
                    await handleExportLocal();
                  }}>导出到本地</button>
                  <button type="button" className={styles.dialogDanger} onClick={() => { setCloseDialog(null); animateClose(); }}>
                    仍要关闭
                  </button>
                  <button type="button" className={styles.dialogGhost} onClick={() => setCloseDialog(null)}>取消</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 远端冲突确认 (I-7) */}
      {conflict && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>远端文件已被修改</div>
            <div className={styles.dialogText}>
              {filePath} 在你编辑期间被其他人/进程改动过。覆盖将丢失对方的修改。
            </div>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogDanger} onClick={() => {
                setConflict(null);
                void persistSave(true);
              }}>覆盖并保存</button>
              <button type="button" className={styles.dialogPrimary} onClick={() => {
                setConflict(null);
                void loadFile();
              }}>放弃修改并重新加载</button>
              <button type="button" className={styles.dialogGhost} onClick={() => setConflict(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className={styles.loading}><FaSpinner size={22} className={styles.spin} /> 正在加载文件…</div>
      )}
      {!isLoading && error && saveStatus !== "error" && (
        <div className={styles.errorBanner}>
          <FaExclamationTriangle size={12} /> {error}
          <button type="button" className={styles.retryInline} onClick={() => void loadFile()}>重试</button>
          <button type="button" className={styles.retryInline} onClick={() => void handleExportLocal()}>导出到本地</button>
        </div>
      )}
    </div>
  );
};
