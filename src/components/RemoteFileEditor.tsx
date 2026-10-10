import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  FaSave, FaSpinner, FaEdit, FaTimes, FaLock, FaSearch, FaRedo,
  FaExclamationTriangle,
} from "react-icons/fa";
import { monaco } from "../editor/monaco-env";
import { MonacoEditor } from "../editor/MonacoEditor";
import { applyMonacoTheme } from "../editor/monaco-theme";
import {
  getInitialThemeId,
  getThemeMode,
  THEME_STORAGE_KEY,
} from "../utils/theme-helpers";
import { APP_THEMES, DEFAULT_THEME } from "../utils/app-themes";
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

const getBaseName = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
};

const formatSavedTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const RemoteFileEditor: React.FC<RemoteFileEditorProps> = ({
  serverId,
  filePath,
  onClose,
  onSaved,
}) => {
  const [content, setContent] = useState<string>("");
  const [language, setLanguage] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [eol, setEol] = useState<"LF" | "CRLF">("LF");
  const [closing, setClosing] = useState(false);
  const [themeId, setThemeId] = useState(getInitialThemeId());
  // 打开即编辑；只读为显式态
  const [isReadOnly, setIsReadOnly] = useState(false);

  const [closeDialog, setCloseDialog] = useState<null | "dirty" | "saveFailed">(null);
  const [conflict, setConflict] = useState<null | RemoteFileStat>(null);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalContentRef = useRef<string>("");
  // 最新编辑内容（含保存飞行中），供关闭/脏检查读取
  const contentRef = useRef<string>("");
  const fileStatRef = useRef<RemoteFileStat | null>(null);
  const forceCloseRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const mountedRef = useRef(true);

  const theme = useMemo(
    () => APP_THEMES[themeId] ?? APP_THEMES[DEFAULT_THEME],
    [themeId],
  );
  const themeName = useMemo(() => applyMonacoTheme(theme), [theme]);
  const themeMode = useMemo(() => getThemeMode(themeId), [themeId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // 编辑器窗口内同步主题切换（主窗改主题后此处跟随）
  useEffect(() => {
    const applyIfChanged = (id: string | null) => {
      if (id && id !== themeId && APP_THEMES[id]) {
        setThemeId(id);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) applyIfChanged(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    const timer = setInterval(() => {
      applyIfChanged(window.localStorage.getItem(THEME_STORAGE_KEY));
    }, 1000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, [themeId]);

  // Monaco 内容变化 → 脏状态/内容引用
  const handleEditorChange = useCallback((value: string) => {
    contentRef.current = value;
    setContent(value);
    setIsDirty(value !== originalContentRef.current);
    setEol(value.includes("\r\n") ? "CRLF" : "LF");
  }, []);

  const handleCursorChange = useCallback((line: number, column: number) => {
    setCursorLine(line);
    setCursorCol(column);
  }, []);

  // ── 加载 ──
  const loadFile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<FileContent>("get_file_content", {
        serverId,
        path: filePath,
        themeMode,
      });
      if (!mountedRef.current) return;
      contentRef.current = result.raw;
      setContent(result.raw);
      setLanguage(result.language);
      setEol(result.raw.includes("\r\n") ? "CRLF" : "LF");
      originalContentRef.current = result.raw;
      setIsDirty(false);
      invoke<RemoteFileStat>("stat_remote_file", { serverId, path: filePath })
        .then((stat) => {
          if (mountedRef.current) fileStatRef.current = stat;
        })
        .catch(() => {
          fileStatRef.current = null;
        });
      void invoke("log_frontend_action", {
        module: "Editor",
        message: `加载文件成功: ${filePath} (${result.language}, ${result.lineCount} 行)`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = typeof err === "string" ? err : "加载文件失败";
      setError(msg);
      void invoke("log_frontend_action", {
        module: "Editor",
        message: `加载文件失败: ${filePath} — ${msg}`,
      });
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [serverId, filePath, themeMode]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  // ── 保存流（四态 + 冲突检测） ──
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

  const persistSave = useCallback(
    async (force = false): Promise<boolean> => {
      const snapshot = contentRef.current;
      setSaveStatus("saving");
      setError(null);
      void invoke("log_frontend_action", {
        module: "Editor",
        message: `保存文件: ${filePath}`,
      });

      // 冲突检测：远端在加载后被改动过则先询问
      if (!force) {
        try {
          const stat = await invoke<RemoteFileStat>("stat_remote_file", {
            serverId,
            path: filePath,
          });
          const base = fileStatRef.current;
          if (base && (stat.size !== base.size || stat.mtime !== base.mtime)) {
            setSaveStatus("idle");
            setConflict(stat);
            return false;
          }
        } catch {
          /* stat 失败不阻塞保存 */
        }
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
        void invoke("log_frontend_action", {
          module: "Editor",
          message: `保存成功: ${filePath}`,
        });
        invoke<RemoteFileStat>("stat_remote_file", { serverId, path: filePath })
          .then((stat) => {
            if (mountedRef.current) fileStatRef.current = stat;
          })
          .catch(() => {});
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setSaveStatus("idle");
        }, 2600);
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
        void invoke("log_frontend_action", {
          module: "Editor",
          message: `保存失败: ${filePath} — ${msg}`,
        });
        if (pendingCloseRef.current) {
          pendingCloseRef.current = false;
          setCloseDialog("saveFailed");
        }
        return false;
      }
    },
    [serverId, filePath, onSaved, animateClose],
  );

  const handleSave = useCallback(() => {
    void persistSave();
  }, [persistSave]);

  // 导出到本地（保存失败降级出口）
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

  // ── 关闭流（三态确认；OS 关闭/按钮统一卡口） ──
  const requestClose = useCallback(() => {
    if (saveStatus === "saving") return;
    if (contentRef.current !== originalContentRef.current) {
      setCloseDialog("dirty");
      return;
    }
    animateClose();
  }, [saveStatus, animateClose]);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    void win.onCloseRequested((event) => {
      // disposed 检查必须在 preventDefault 之前
      if (disposed) return;
      if (forceCloseRef.current) return;
      event.preventDefault();
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

  // ── 快捷键：⌘S 拦截；⌘F/⌘H 交给 Monaco 自带查找；Esc 只关对话框 ──
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const primary = isMac ? event.metaKey : event.ctrlKey;

      if (primary && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (saveStatus !== "saving") void persistSave();
        return;
      }
      if (event.key === "Escape") {
        if (closeDialog) {
          event.preventDefault();
          setCloseDialog(null);
        } else if (conflict) {
          event.preventDefault();
          setConflict(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveStatus, persistSave, closeDialog, conflict]);

  const handleReset = useCallback(() => {
    const original = originalContentRef.current;
    contentRef.current = original;
    setContent(original);
    setIsDirty(false);
    void invoke("log_frontend_action", {
      module: "Editor",
      message: `重置内容: ${filePath}`,
    });
  }, [filePath]);

  const handleToggleEdit = useCallback(() => {
    setIsReadOnly((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => editorRef.current?.updateOptions({ readOnly: true }), 0);
      } else {
        setTimeout(() => editorRef.current?.focus(), 0);
      }
      return next;
    });
    void invoke("log_frontend_action", {
      module: "Editor",
      message: `切换模式: ${filePath}`,
    });
  }, [filePath]);

  const openFind = useCallback(() => {
    editorRef.current?.getAction("actions.find")?.run();
  }, []);

  const dirty = isDirty;
  const fileName = getBaseName(filePath);

  return (
    <div
      className={styles.editorOverlay}
      data-mode={isReadOnly ? "readonly" : "editing"}
      data-closing={closing || undefined}
    >
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.fileBadge}>
            {!isReadOnly && <span className={styles.accentBar} />}
            {isReadOnly && <FaLock size={10} className={styles.lockIcon} />}
            <span className={styles.fileName} title={filePath}>
              {fileName}
            </span>
            {dirty && <span className={styles.dirtyDot} title="有未保存的修改" />}
          </div>
          <span className={styles.langBadge}>{language || "text"}</span>
          <span
            className={`${styles.modePill} ${isReadOnly ? styles.modeReadonly : styles.modeEditing}`}
          >
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
                {saveStatus === "saving" ? (
                  <FaSpinner size={11} className={styles.spin} />
                ) : (
                  <FaSave size={11} />
                )}
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
            onClick={openFind}
            title="查找 (⌘F)"
          >
            <FaSearch size={11} />
          </button>
          <button
            type="button"
            className={styles.closeButton}
            onClick={requestClose}
            title="关闭"
          >
            <FaTimes size={12} />
          </button>
        </div>
      </div>

      <div className={styles.editorBody}>
        <MonacoEditor
          path={filePath}
          language={language}
          value={content}
          readOnly={isReadOnly}
          themeName={themeName}
          onChange={handleEditorChange}
          onCursorChange={handleCursorChange}
          editorRef={editorRef}
        />
      </div>

      <div className={styles.statusBar}>
        <span className={styles.statusPath} title={filePath}>
          {filePath}
        </span>
        <div className={styles.statusRight}>
          {saveStatus === "error" && (
            <button type="button" className={styles.retryInline} onClick={handleSave}>
              <FaExclamationTriangle size={10} /> 保存失败 · 重试
            </button>
          )}
          <span
            className={`${styles.statusPill} ${
              saveStatus === "saving"
                ? styles.pillSaving
                : saveStatus === "saved"
                  ? styles.pillSaved
                  : saveStatus === "error"
                    ? styles.pillError
                    : dirty
                      ? styles.pillDirty
                      : styles.pillIdle
            }`}
          >
            {saveStatus === "saving" && (
              <>
                <FaSpinner size={9} className={styles.spin} /> 保存中
              </>
            )}
            {saveStatus === "saved" && (
              <>
                ✓ 已同步{lastSavedAt ? ` ${formatSavedTime(lastSavedAt)}` : ""}
              </>
            )}
            {saveStatus === "error" && <>✗ 同步失败</>}
            {saveStatus === "idle" && (dirty ? "● 已修改" : "已同步")}
          </span>
          <span className={styles.statusItem}>{language || "text"}</span>
          <span className={styles.statusItem}>{eol}</span>
          <span className={styles.statusItem}>UTF-8</span>
          <span className={styles.statusItem}>
            {cursorLine}:{cursorCol}
          </span>
        </div>
      </div>

      {/* 关闭三态确认 */}
      {closeDialog && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>
              {closeDialog === "saveFailed"
                ? "保存失败，仍要关闭吗？"
                : "文件有未保存的修改"}
            </div>
            <div className={styles.dialogText}>
              {closeDialog === "saveFailed"
                ? "建议先导出到本地保留副本，避免修改丢失。"
                : `${fileName} 的修改尚未保存到远端。`}
            </div>
            <div className={styles.dialogActions}>
              {closeDialog === "dirty" ? (
                <>
                  <button
                    type="button"
                    className={styles.dialogPrimary}
                    onClick={() => {
                      setCloseDialog(null);
                      pendingCloseRef.current = true;
                      void persistSave();
                    }}
                  >
                    保存并关闭
                  </button>
                  <button
                    type="button"
                    className={styles.dialogDanger}
                    onClick={() => {
                      setCloseDialog(null);
                      animateClose();
                    }}
                  >
                    放弃修改
                  </button>
                  <button
                    type="button"
                    className={styles.dialogGhost}
                    onClick={() => setCloseDialog(null)}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.dialogPrimary}
                    onClick={() => {
                      setCloseDialog(null);
                      void handleExportLocal();
                    }}
                  >
                    导出到本地
                  </button>
                  <button
                    type="button"
                    className={styles.dialogDanger}
                    onClick={() => {
                      setCloseDialog(null);
                      animateClose();
                    }}
                  >
                    仍要关闭
                  </button>
                  <button
                    type="button"
                    className={styles.dialogGhost}
                    onClick={() => setCloseDialog(null)}
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 远端冲突确认 */}
      {conflict && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>远端文件已被修改</div>
            <div className={styles.dialogText}>
              {filePath} 在你编辑期间被其他人/进程改动过。覆盖将丢失对方的修改。
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogDanger}
                onClick={() => {
                  setConflict(null);
                  void persistSave(true);
                }}
              >
                覆盖并保存
              </button>
              <button
                type="button"
                className={styles.dialogPrimary}
                onClick={() => {
                  setConflict(null);
                  void loadFile();
                }}
              >
                放弃修改并重新加载
              </button>
              <button
                type="button"
                className={styles.dialogGhost}
                onClick={() => setConflict(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className={styles.loading}>
          <FaSpinner size={22} className={styles.spin} /> 正在加载文件…
        </div>
      )}
      {!isLoading && error && saveStatus !== "error" && (
        <div className={styles.errorBanner}>
          <FaExclamationTriangle size={12} /> {error}
          <button type="button" className={styles.retryInline} onClick={() => void loadFile()}>
            重试
          </button>
          <button
            type="button"
            className={styles.retryInline}
            onClick={() => void handleExportLocal()}
          >
            导出到本地
          </button>
        </div>
      )}
    </div>
  );
};
