import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { FaSave, FaSpinner, FaUndo, FaEdit } from "react-icons/fa";
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
  const [isReadOnly, setIsReadOnly] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef<string>("");

  // Load file content
  const loadFile = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await invoke<FileContent>("get_file_content", {
        serverId,
        path: filePath,
      });

      setContent(result.raw);
      setHighlightedHtml(result.html);
      setLanguage(result.language);
      setLineCount(result.lineCount);
      originalContentRef.current = result.raw;
      setIsDirty(false);
    } catch (err) {
      setError(typeof err === "string" ? err : "加载文件失败");
    } finally {
      setIsLoading(false);
    }
  }, [serverId, filePath]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

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
          });
          setHighlightedHtml(result.html);
        } catch {
          // Highlighting failure is non-fatal
        }
      }, 300);
    },
    [],
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

  // Sync scroll between textarea, highlight, and line numbers
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    const lineNumbers = lineNumbersRef.current;

    if (textarea && highlight) {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    }
    if (textarea && lineNumbers) {
      lineNumbers.scrollTop = textarea.scrollTop;
    }
  }, []);

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
    try {
      await invoke<string>("save_remote_file", {
        serverId,
        path: filePath,
        content,
      });
      originalContentRef.current = content;
      setIsDirty(false);
      setSaveStatus("saved");
      onSaved?.();
      // Notify main window to refresh file list
      void emit("editor-file-saved", { serverId, filePath });
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setSaveStatus("error");
      setError(typeof err === "string" ? err : "保存失败");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [serverId, filePath, content, onSaved]);

  // Reset to original content
  const handleReset = useCallback(() => {
    const original = originalContentRef.current;
    setContent(original);
    setIsDirty(false);
    setLineCount(original.split("\n").length);
    scheduleHighlight(original, language);
  }, [language, scheduleHighlight]);

  // Toggle edit mode
  const handleToggleEdit = useCallback(() => {
    setIsReadOnly(prev => {
      const next = !prev;
      if (!next) {
        // Switching to edit mode: focus textarea and move cursor to top
        requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(0, 0);
          }
        });
      }
      return next;
    });
  }, []);

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

        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = start + 1;
        });
      }
    },
    [language, scheduleHighlight],
  );

  const renderLineNumbers = () => {
    const lines = [];
    for (let i = 1; i <= lineCount; i++) {
      lines.push(
        <span key={i} className={styles.lineNumber}>
          {i}
        </span>,
      );
    }
    return lines;
  };

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

  return (
    <div className={styles.editorOverlay}>
      <div className={styles.toolbar}>
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
        </div>
      </div>

      <div className={styles.editorBody} data-readonly={isReadOnly}>
        {isLoading ? (
          <div className={styles.loading}>正在加载文件...</div>
        ) : error ? (
          <div className={styles.error}>
            <span>{error}</span>
            <button type="button" className={styles.errorRetry} onClick={() => void loadFile()}>
              重试
            </button>
          </div>
        ) : (
          <>
            <div className={styles.lineNumbers} ref={lineNumbersRef}>
              {renderLineNumbers()}
            </div>
            <div className={styles.editorContent} data-readonly={isReadOnly}>
              <pre
                ref={highlightRef}
                className={styles.highlightLayer}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
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
