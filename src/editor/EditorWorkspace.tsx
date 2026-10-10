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
import { monaco } from "./monaco-env";
import { toMonacoLanguage } from "./monaco-language";
import { applyMonacoTheme } from "./monaco-theme";
import {
  getInitialThemeId,
  getThemeMode,
  THEME_STORAGE_KEY,
} from "../utils/theme-helpers";
import { APP_THEMES, DEFAULT_THEME } from "../utils/app-themes";
import styles from "./EditorWorkspace.module.css";

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

interface EditorTab {
  key: string;
  serverId: string;
  filePath: string;
  fileName: string;
  language: string;
  /** 最新内容（以 Model 为准，这里是同步副本，用于脏检查/状态栏） */
  content: string;
  originalContent: string;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  eol: "LF" | "CRLF";
  readOnly: boolean;
  isLoading: boolean;
  error: string | null;
  fileStat: RemoteFileStat | null;
}

type DialogState =
  | null
  | { type: "closeTab"; key: string }
  | { type: "closeWindow" }
  | { type: "saveFailed"; key: string };

const tabKey = (serverId: string, filePath: string) => `${serverId}\u0000${filePath}`;

const getBaseName = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
};

const formatSavedTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export interface EditorWorkspaceProps {
  /** 启动时打开的首个文件（URL 参数），可选 */
  initial?: { serverId: string; filePath: string };
}

/**
 * Monaco 多标签编辑工作区（VS Code 形态）：
 * - 单编辑器实例 + 每文件独立 Model（undo/历史/视图状态互不干扰）
 * - 每文件独立保存状态（四态/冲突检测/脏检查）
 * - 'editor-open' 事件接入新文件；标签/窗口关闭向托盘发 editor-closed
 */
export const EditorWorkspace: React.FC<EditorWorkspaceProps> = ({ initial }) => {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [closing, setClosing] = useState(false);
  const [themeId, setThemeId] = useState(getInitialThemeId());
  // Model 创建/切换后的重同步（触发 setModel 的 effect）
  const [modelsVersion, setModelsVersion] = useState(0);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const prevActiveKeyRef = useRef<string | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const forceCloseRef = useRef(false);
  const initialOpenedRef = useRef(false);
  const mountedRef = useRef(true);

  const theme = useMemo(
    () => APP_THEMES[themeId] ?? APP_THEMES[DEFAULT_THEME],
    [themeId],
  );
  const themeName = useMemo(() => applyMonacoTheme(theme), [theme]);
  const themeMode = useMemo(() => getThemeMode(themeId), [themeId]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 主题跟随
  useEffect(() => {
    const applyIfChanged = (id: string | null) => {
      if (id && id !== themeId && APP_THEMES[id]) setThemeId(id);
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

  useEffect(() => {
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  // ── 打开文件（幂等：已存在则激活） ──
  const openFile = useCallback(
    async (serverId: string, filePath: string) => {
      const key = tabKey(serverId, filePath);
      const existing = tabsRef.current.find((t) => t.key === key);
      if (existing) {
        setActiveKey(key);
        return;
      }

      const fileName = getBaseName(filePath);
      // 先占位（loading），避免并发重复打开
      const placeholder: EditorTab = {
        key,
        serverId,
        filePath,
        fileName,
        language: "",
        content: "",
        originalContent: "",
        saveStatus: "idle",
        lastSavedAt: null,
        eol: "LF",
        readOnly: false,
        isLoading: true,
        error: null,
        fileStat: null,
      };
      setTabs((prev) => [...prev, placeholder]);
      setActiveKey(key);

      try {
        const result = await invoke<FileContent>("get_file_content", {
          serverId,
          path: filePath,
          themeMode,
        });
        if (!mountedRef.current) return;

        const model = monaco.editor.createModel(
          result.raw,
          toMonacoLanguage(result.language, filePath),
          monaco.Uri.parse(`server-pilot://${serverId}${filePath}`),
        );
        model.onDidChangeContent(() => {
          const value = model.getValue();
          setTabs((prev) =>
            prev.map((t) =>
              t.key === key
                ? {
                    ...t,
                    content: value,
                    eol: value.includes("\r\n") ? "CRLF" : "LF",
                  }
                : t,
            ),
          );
        });
        modelsRef.current.set(key, model);

        setTabs((prev) =>
          prev.map((t) =>
            t.key === key
              ? {
                  ...t,
                  language: result.language,
                  content: result.raw,
                  originalContent: result.raw,
                  eol: result.raw.includes("\r\n") ? "CRLF" : "LF",
                  isLoading: false,
                }
              : t,
          ),
        );
        setModelsVersion((v) => v + 1);

        invoke<RemoteFileStat>("stat_remote_file", { serverId, path: filePath })
          .then((stat) => {
            if (!mountedRef.current) return;
            setTabs((prev) =>
              prev.map((t) => (t.key === key ? { ...t, fileStat: stat } : t)),
            );
          })
          .catch(() => {});
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = typeof err === "string" ? err : "加载文件失败";
        setTabs((prev) =>
          prev.map((t) =>
            t.key === key ? { ...t, isLoading: false, error: msg } : t,
          ),
        );
      }
    },
    [themeMode],
  );

  // 首个文件（URL 参数）
  useEffect(() => {
    if (!initial || initialOpenedRef.current) return;
    initialOpenedRef.current = true;
    void openFile(initial.serverId, initial.filePath);
  }, [initial, openFile]);

  // 'editor-open' 事件接入
  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void win
      .listen<{ serverId: string; filePath: string }>("editor-open", (event) => {
        if (disposed) return;
        void openFile(event.payload.serverId, event.payload.filePath);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openFile]);

  // ── 编辑器实例（一次性创建） ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      automaticLayout: true,
      theme: themeName,
      minimap: { enabled: true, size: "proportional" },
      bracketPairColorization: { enabled: true },
      guides: {
        indentation: true,
        bracketPairs: true,
        highlightActiveIndentation: true,
      },
      renderLineHighlight: "all",
      wordWrap: "off",
      folding: true,
      smoothScrolling: true,
      stickyScroll: { enabled: true },
      fontSize: 13,
      lineHeight: 21,
      fontFamily:
        "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
      padding: { top: 12, bottom: 12 },
      scrollBeyondLastLine: false,
    });
    editorRef.current = editor;
    const cursorSub = editor.onDidChangeCursorPosition((e) => {
      setCursor({ line: e.position.lineNumber, column: e.position.column });
    });
    return () => {
      cursorSub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 激活标签切换 → 换 Model（保留每文件 undo 与视图状态）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const prev = prevActiveKeyRef.current;
    if (prev) {
      viewStatesRef.current.set(prev, editor.saveViewState());
    }
    const model = activeKey ? modelsRef.current.get(activeKey) : undefined;
    if (model) {
      editor.setModel(model);
      const vs = activeKey ? viewStatesRef.current.get(activeKey) : undefined;
      if (vs) editor.restoreViewState(vs);
      editor.focus();
    } else if (activeKey === null) {
      editor.setModel(null);
    }
    prevActiveKeyRef.current = activeKey;
  }, [activeKey, modelsVersion]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.key === activeKey) ?? null,
    [tabs, activeKey],
  );

  const updateTab = useCallback(
    (key: string, patch: Partial<EditorTab>) => {
      setTabs((prev) =>
        prev.map((t) => (t.key === key ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  // ── 保存（含冲突检测） ──
  const persistSave = useCallback(
    async (key: string, force = false): Promise<boolean> => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab) return false;
      const snapshot = modelsRef.current.get(key)?.getValue() ?? tab.content;
      updateTab(key, { saveStatus: "saving", error: null });

      if (!force) {
        try {
          const stat = await invoke<RemoteFileStat>("stat_remote_file", {
            serverId: tab.serverId,
            path: tab.filePath,
          });
          const base = tab.fileStat;
          if (base && (stat.size !== base.size || stat.mtime !== base.mtime)) {
            updateTab(key, { saveStatus: "idle" });
            setConflictState({ key, stat });
            return false;
          }
        } catch {
          /* stat 失败不阻塞保存 */
        }
      }

      try {
        await invoke<string>("save_remote_file", {
          serverId: tab.serverId,
          path: tab.filePath,
          content: snapshot,
        });
        if (!mountedRef.current) return true;
        updateTab(key, {
          originalContent: snapshot,
          saveStatus: "saved",
          lastSavedAt: Date.now(),
        });
        void emit("editor-file-saved", {
          serverId: tab.serverId,
          filePath: tab.filePath,
        });
        invoke<RemoteFileStat>("stat_remote_file", {
          serverId: tab.serverId,
          path: tab.filePath,
        })
          .then((stat) => {
            if (mountedRef.current) updateTab(key, { fileStat: stat });
          })
          .catch(() => {});
        setTimeout(() => {
          if (mountedRef.current) {
            updateTab(key, { saveStatus: "idle" });
          }
        }, 2600);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        const msg = typeof err === "string" ? err : "保存失败";
        updateTab(key, { saveStatus: "error", error: msg });
        return false;
      }
    },
    [updateTab],
  );

  // 远端冲突对话框（独立于 dialog 状态）
  const [conflictState, setConflictState] = useState<
    null | { key: string; stat: RemoteFileStat }
  >(null);

  // ── 窗口关闭（聚合脏检查） ──
  const animateClose = useCallback(() => {
    if (forceCloseRef.current) return;
    forceCloseRef.current = true;
    setClosing(true);
    for (const t of tabsRef.current) {
      void emit("editor-closed", { serverId: t.serverId, filePath: t.filePath });
    }
    setTimeout(() => {
      void getCurrentWindow().close().catch(() => {});
    }, 150);
  }, []);

  // ── 关闭单个标签 ──
  const disposeTab = useCallback((key: string) => {
    modelsRef.current.get(key)?.dispose();
    modelsRef.current.delete(key);
    viewStatesRef.current.delete(key);
    const tab = tabsRef.current.find((t) => t.key === key);
    if (tab) {
      void emit("editor-closed", { serverId: tab.serverId, filePath: tab.filePath });
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      // 最后一个标签 → 关闭窗口
      if (next.length === 0) {
        setTimeout(() => animateClose(), 0);
      } else if (activeKey === key) {
        const idx = prev.findIndex((t) => t.key === key);
        const neighbor = next[Math.min(idx, next.length - 1)];
        setActiveKey(neighbor.key);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, animateClose]);

  const requestCloseTab = useCallback(
    (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab) return;
      const modelValue = modelsRef.current.get(key)?.getValue();
      const dirty = modelValue !== undefined && modelValue !== tab.originalContent;
      if (dirty) {
        setDialog({ type: "closeTab", key });
        return;
      }
      disposeTab(key);
    },
    [disposeTab],
  );

  const requestCloseWindow = useCallback(() => {
    const dirtyTabs = tabsRef.current.filter((t) => {
      const v = modelsRef.current.get(t.key)?.getValue();
      return v !== undefined && v !== t.originalContent;
    });
    if (dirtyTabs.length > 0) {
      setDialog({ type: "closeWindow" });
      return;
    }
    animateClose();
  }, [animateClose]);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    void win.onCloseRequested((event) => {
      if (disposed) return;
      if (forceCloseRef.current) return;
      event.preventDefault();
      requestCloseWindow();
    });
    return () => {
      disposed = true;
    };
  }, [requestCloseWindow]);

  // ── 快捷键 ──
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const primary = isMac ? event.metaKey : event.ctrlKey;

      if (primary && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeKey) void persistSave(activeKey);
        return;
      }
      if (primary && event.key.toLowerCase() === "w") {
        // 关闭当前标签（若原生抢占则走窗口关闭卡口，同样安全）
        event.preventDefault();
        if (activeKey) requestCloseTab(activeKey);
        return;
      }
      if (event.key === "Escape") {
        if (conflictState) {
          event.preventDefault();
          setConflictState(null);
        } else if (dialog) {
          event.preventDefault();
          setDialog(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeKey, persistSave, requestCloseTab, dialog, conflictState]);

  // ── 工具栏动作 ──
  const handleReset = useCallback(() => {
    if (!activeTab) return;
    const model = modelsRef.current.get(activeTab.key);
    if (model && model.getValue() !== activeTab.originalContent) {
      model.setValue(activeTab.originalContent);
    }
    updateTab(activeTab.key, { originalContent: activeTab.originalContent });
  }, [activeTab, updateTab]);

  const handleToggleEdit = useCallback(() => {
    if (!activeTab) return;
    const next = !activeTab.readOnly;
    updateTab(activeTab.key, { readOnly: next });
    editorRef.current?.updateOptions({ readOnly: next });
    if (!next) setTimeout(() => editorRef.current?.focus(), 0);
  }, [activeTab, updateTab]);

  const openFind = useCallback(() => {
    editorRef.current?.getAction("actions.find")?.run();
  }, []);

  const handleExportLocal = useCallback(async (key: string) => {
    const tab = tabsRef.current.find((t) => t.key === key);
    if (!tab) return;
    try {
      const target = await saveDialog({
        title: "导出到本地",
        defaultPath: tab.fileName,
      });
      if (!target) return;
      const value = modelsRef.current.get(key)?.getValue() ?? tab.content;
      await writeTextFile(target, value);
      updateTab(key, { error: null });
    } catch (err) {
      updateTab(key, {
        error: `导出失败: ${typeof err === "string" ? err : String(err)}`,
      });
    }
  }, [updateTab]);

  // 对话框动作：保存并关闭（单标签/全窗）
  const saveAndCloseTab = useCallback(
    async (key: string) => {
      const ok = await persistSave(key);
      if (ok) {
        disposeTab(key);
      } else {
        setDialog({ type: "saveFailed", key });
      }
    },
    [persistSave, disposeTab],
  );

  const saveAllAndCloseWindow = useCallback(async () => {
    const dirtyTabs = tabsRef.current.filter((t) => {
      const v = modelsRef.current.get(t.key)?.getValue();
      return v !== undefined && v !== t.originalContent;
    });
    for (const t of dirtyTabs) {
      const ok = await persistSave(t.key);
      if (!ok) {
        setDialog({ type: "saveFailed", key: t.key });
        return;
      }
    }
    animateClose();
  }, [persistSave, animateClose]);

  // 只读切换需要跟随 active tab
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: activeTab?.readOnly ?? false });
  }, [activeKey, activeTab?.readOnly]);

  const dirtyTabsCount = useMemo(
    () =>
      tabs.filter((t) => {
        const v = modelsRef.current.get(t.key)?.getValue();
        return v !== undefined && v !== t.originalContent;
      }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, modelsVersion],
  );

  return (
    <div
      className={styles.workspace}
      data-closing={closing || undefined}
    >
      {/* ── 标签栏 ── */}
      <div className={styles.tabBar}>
        <div className={styles.tabList}>
          {tabs.map((tab) => {
            const modelValue = modelsRef.current.get(tab.key)?.getValue();
            const dirty = modelValue !== undefined && modelValue !== tab.originalContent;
            return (
              <div
                key={tab.key}
                className={styles.tab}
                data-active={tab.key === activeKey}
                onClick={() => setActiveKey(tab.key)}
                title={tab.filePath}
              >
                {dirty && <span className={styles.tabDot} />}
                <span className={styles.tabName}>{tab.fileName}</span>
                <button
                  type="button"
                  className={styles.tabClose}
                  title="关闭标签"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseTab(tab.key);
                  }}
                >
                  <FaTimes size={9} />
                </button>
              </div>
            );
          })}
        </div>
        <div className={styles.tabBarRight}>
          {dirtyTabsCount > 0 && (
            <span className={styles.dirtyBadge}>{dirtyTabsCount} 未保存</span>
          )}
        </div>
      </div>

      {/* ── 工具栏（针对当前标签） ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.fileBadge}>
            {activeTab && !activeTab.readOnly && <span className={styles.accentBar} />}
            {activeTab?.readOnly && <FaLock size={10} className={styles.lockIcon} />}
            <span className={styles.fileName} title={activeTab?.filePath ?? ""}>
              {activeTab ? activeTab.fileName : "编辑工作区"}
            </span>
            {activeTab &&
              activeTab.content !== activeTab.originalContent && (
                <span className={styles.dirtyDot} title="有未保存的修改" />
              )}
          </div>
          {activeTab && (
            <>
              <span className={styles.langBadge}>{activeTab.language || "text"}</span>
              <span
                className={`${styles.modePill} ${activeTab.readOnly ? styles.modeReadonly : styles.modeEditing}`}
              >
                {activeTab.readOnly ? "只读" : "编辑中"}
              </span>
            </>
          )}
        </div>
        <div className={styles.toolbarRight}>
          {activeTab && !activeTab.readOnly && (
            <>
              <button
                type="button"
                className={styles.toolbarButton}
                onClick={handleReset}
                disabled={activeTab.content === activeTab.originalContent}
                title="重置为原始内容"
              >
                <FaRedo size={11} /> 重置
              </button>
              <button
                type="button"
                className={`${styles.toolbarButton} ${styles.primary}`}
                onClick={() => activeKey && void persistSave(activeKey)}
                disabled={
                  activeTab.content === activeTab.originalContent ||
                  activeTab.saveStatus === "saving"
                }
                title="保存 (⌘S)"
              >
                {activeTab.saveStatus === "saving" ? (
                  <FaSpinner size={11} className={styles.spin} />
                ) : (
                  <FaSave size={11} />
                )}
                <span>
                  {activeTab.saveStatus === "saving" ? "保存中…" : "保存"}
                </span>
              </button>
            </>
          )}
          {activeTab && (
            <button
              type="button"
              className={`${styles.toolbarButton} ${activeTab.readOnly ? styles.toggleOn : ""}`}
              onClick={handleToggleEdit}
              title={activeTab.readOnly ? "进入编辑模式" : "切换为只读"}
            >
              <FaEdit size={11} /> {activeTab.readOnly ? "编辑" : "只读"}
            </button>
          )}
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={openFind}
            title="查找 (⌘F)"
            disabled={!activeTab}
          >
            <FaSearch size={11} />
          </button>
          <button
            type="button"
            className={styles.closeButton}
            onClick={requestCloseWindow}
            title="关闭窗口"
          >
            <FaTimes size={12} />
          </button>
        </div>
      </div>

      {/* ── 编辑区 ── */}
      <div className={styles.editorBody}>
        <div ref={hostRef} className={styles.monacoHost} />
        {(!activeTab || activeTab.isLoading) && (
          <div className={styles.loading}>
            <FaSpinner size={22} className={styles.spin} />{" "}
            {activeTab ? "正在加载文件…" : "双击文件管理器中的文件开始编辑"}
          </div>
        )}
        {activeTab && !activeTab.isLoading && activeTab.error && (
          <div className={styles.errorBanner}>
            <FaExclamationTriangle size={12} /> {activeTab.error}
            <button
              type="button"
              className={styles.retryInline}
              onClick={() => void openFile(activeTab.serverId, activeTab.filePath)}
            >
              重试
            </button>
            <button
              type="button"
              className={styles.retryInline}
              onClick={() => void handleExportLocal(activeTab.key)}
            >
              导出到本地
            </button>
          </div>
        )}
      </div>

      {/* ── 状态栏 ── */}
      <div className={styles.statusBar}>
        <span className={styles.statusPath} title={activeTab?.filePath ?? ""}>
          {activeTab ? `${activeTab.fileName} — ${activeTab.filePath}` : "无打开的文件"}
        </span>
        <div className={styles.statusRight}>
          {activeTab?.saveStatus === "error" && (
            <button
              type="button"
              className={styles.retryInline}
              onClick={() => activeKey && void persistSave(activeKey)}
            >
              <FaExclamationTriangle size={10} /> 保存失败 · 重试
            </button>
          )}
          {activeTab && (
            <span
              className={`${styles.statusPill} ${
                activeTab.saveStatus === "saving"
                  ? styles.pillSaving
                  : activeTab.saveStatus === "saved"
                    ? styles.pillSaved
                    : activeTab.saveStatus === "error"
                      ? styles.pillError
                      : activeTab.content !== activeTab.originalContent
                        ? styles.pillDirty
                        : styles.pillIdle
              }`}
            >
              {activeTab.saveStatus === "saving" && (
                <>
                  <FaSpinner size={9} className={styles.spin} /> 保存中
                </>
              )}
              {activeTab.saveStatus === "saved" && (
                <>
                  ✓ 已同步
                  {activeTab.lastSavedAt
                    ? ` ${formatSavedTime(activeTab.lastSavedAt)}`
                    : ""}
                </>
              )}
              {activeTab.saveStatus === "error" && <>✗ 同步失败</>}
              {activeTab.saveStatus === "idle" &&
                (activeTab.content !== activeTab.originalContent
                  ? "● 已修改"
                  : "已同步")}
            </span>
          )}
          {activeTab && (
            <>
              <span className={styles.statusItem}>{activeTab.language || "text"}</span>
              <span className={styles.statusItem}>{activeTab.eol}</span>
              <span className={styles.statusItem}>UTF-8</span>
            </>
          )}
          <span className={styles.statusItem}>
            {cursor.line}:{cursor.column}
          </span>
        </div>
      </div>

      {/* ── 对话框：关闭标签 / 关闭窗口 / 保存失败 ── */}
      {dialog && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>
              {dialog.type === "closeTab"
                ? "文件有未保存的修改"
                : dialog.type === "closeWindow"
                  ? dirtyTabsCount > 0
                    ? `${dirtyTabsCount} 个文件未保存`
                    : "关闭编辑工作区"
                  : "保存失败，仍要关闭吗？"}
            </div>
            <div className={styles.dialogText}>
              {dialog.type === "closeTab"
                ? `${tabs.find((t) => t.key === dialog.key)?.fileName ?? ""} 的修改尚未保存到远端。`
                : dialog.type === "closeWindow"
                  ? "关闭将丢失未保存到远端的修改。"
                  : "建议先导出到本地保留副本，避免修改丢失。"}
            </div>
            <div className={styles.dialogActions}>
              {dialog.type === "closeTab" && (
                <>
                  <button
                    type="button"
                    className={styles.dialogPrimary}
                    onClick={() => {
                      const key = dialog.key;
                      setDialog(null);
                      void saveAndCloseTab(key);
                    }}
                  >
                    保存并关闭
                  </button>
                  <button
                    type="button"
                    className={styles.dialogDanger}
                    onClick={() => {
                      const key = dialog.key;
                      setDialog(null);
                      disposeTab(key);
                    }}
                  >
                    放弃修改
                  </button>
                  <button
                    type="button"
                    className={styles.dialogGhost}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                </>
              )}
              {dialog.type === "closeWindow" && (
                <>
                  <button
                    type="button"
                    className={styles.dialogPrimary}
                    onClick={() => {
                      setDialog(null);
                      void saveAllAndCloseWindow();
                    }}
                  >
                    保存全部并关闭
                  </button>
                  <button
                    type="button"
                    className={styles.dialogDanger}
                    onClick={() => {
                      setDialog(null);
                      animateClose();
                    }}
                  >
                    放弃并关闭
                  </button>
                  <button
                    type="button"
                    className={styles.dialogGhost}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                </>
              )}
              {dialog.type === "saveFailed" && (
                <>
                  <button
                    type="button"
                    className={styles.dialogPrimary}
                    onClick={() => {
                      const key = dialog.key;
                      setDialog(null);
                      void handleExportLocal(key);
                    }}
                  >
                    导出到本地
                  </button>
                  <button
                    type="button"
                    className={styles.dialogDanger}
                    onClick={() => {
                      const key = dialog.key;
                      setDialog(null);
                      if (tabsRef.current.length <= 1) {
                        animateClose();
                      } else {
                        disposeTab(key);
                      }
                    }}
                  >
                    仍要关闭
                  </button>
                  <button
                    type="button"
                    className={styles.dialogGhost}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 远端冲突 ── */}
      {conflictState && (
        <div className={styles.dialogOverlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>远端文件已被修改</div>
            <div className={styles.dialogText}>
              {tabs.find((t) => t.key === conflictState.key)?.filePath} 在你编辑期间被其他人/进程改动过。
              覆盖将丢失对方的修改。
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogDanger}
                onClick={() => {
                  const key = conflictState.key;
                  setConflictState(null);
                  void persistSave(key, true);
                }}
              >
                覆盖并保存
              </button>
              <button
                type="button"
                className={styles.dialogPrimary}
                onClick={() => {
                  const tab = tabsRef.current.find((t) => t.key === conflictState.key);
                  setConflictState(null);
                  if (tab) {
                    // 重新加载：销毁 Model 由 openFile 重建
                    modelsRef.current.get(tab.key)?.dispose();
                    modelsRef.current.delete(tab.key);
                    setTabs((prev) => prev.filter((t) => t.key !== tab.key));
                    void openFile(tab.serverId, tab.filePath);
                  }
                }}
              >
                放弃修改并重新加载
              </button>
              <button
                type="button"
                className={styles.dialogGhost}
                onClick={() => setConflictState(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
