import { useEffect, useRef } from "react";
import type { FC, MutableRefObject } from "react";
import { monaco } from "./monaco-env";
import { toMonacoLanguage } from "./monaco-language";

export interface MonacoEditorProps {
  /** 文件路径 —— 用作 Model URI（决定语言服务行为） */
  path: string;
  /** 后端识别的语言标识 */
  language: string;
  /** 外部内容（加载/重置）；编辑期间以 Model 为准 */
  value: string;
  readOnly: boolean;
  themeName: string;
  onChange: (value: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  /** 暴露编辑器实例给父组件（⌘F 等命令） */
  editorRef?: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
}

/**
 * Monaco 编辑器封装（VS Code 同源内核）。
 *
 * - Model 以文件 URI 创建：多标签场景天然隔离 undo/历史
 * - automaticLayout：WKWebView 尺寸变化自动跟随
 * - value 仅在外部变化（加载/重置）时写入，不打断用户输入
 */
export const MonacoEditor: FC<MonacoEditorProps> = ({
  path,
  language,
  value,
  readOnly,
  themeName,
  onChange,
  onCursorChange,
  editorRef,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const lastExternalValueRef = useRef<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    onCursorChangeRef.current = onCursorChange;
  }, [onChange, onCursorChange]);

  // 创建/销毁（每次 path 变化重建 Model）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const model = monaco.editor.createModel(
      value,
      toMonacoLanguage(language, path),
      monaco.Uri.file(path),
    );
    const editor = monaco.editor.create(container, {
      model,
      theme: themeName,
      automaticLayout: true,
      readOnly,
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
    editorInstanceRef.current = editor;
    if (editorRef) editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(model.getValue());
    });
    const cursorSub = editor.onDidChangeCursorPosition((e) => {
      onCursorChangeRef.current?.(e.position.lineNumber, e.position.column);
    });

    return () => {
      changeSub.dispose();
      cursorSub.dispose();
      editor.dispose();
      model.dispose();
      editorInstanceRef.current = null;
      if (editorRef) editorRef.current = null;
    };
    // path/language 决定 Model 生命周期；theme/read-only 由下面的 effect 平滑切换
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language]);

  // 外部内容写入（加载完成/重置），不覆盖正在输入的内容
  useEffect(() => {
    const editor = editorInstanceRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (lastExternalValueRef.current === value) return;
    lastExternalValueRef.current = value;
    if (model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  // 主题切换
  useEffect(() => {
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  // 只读切换
  useEffect(() => {
    editorInstanceRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0 }}
      aria-label="代码编辑器"
    />
  );
};
