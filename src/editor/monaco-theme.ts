// 应用主题色板 → Monaco 编辑器主题。
// 注意：Monaco/VS Code 的颜色键只接受 #RRGGBB（或 #RRGGBBAA），
// 我们主题里有 rgba()/CSS 变量值，需要归一化成 hex。
import { monaco } from "./monaco-env";
import type { AppTheme } from "../types/theme";

function hex(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  return fallback;
}

/** 定义（并返回）主题名，editor 创建/切换后用 monaco.editor.setTheme 应用。 */
export function applyMonacoTheme(theme: AppTheme): string {
  const name = `app-${theme.id}`;
  const c = theme.colors;
  monaco.editor.defineTheme(name, {
    base: theme.type === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex(c.textMuted, "6a737d"), fontStyle: "italic" },
      { token: "keyword", foreground: hex(c.terminalMagenta, "c586c0") },
      { token: "string", foreground: hex(c.terminalGreen, "ce9178") },
      { token: "number", foreground: hex(c.terminalYellow, "b5cea8") },
      { token: "regexp", foreground: hex(c.terminalRed, "d16969") },
      { token: "type", foreground: hex(c.terminalCyan, "4ec9b0") },
      { token: "namespace", foreground: hex(c.terminalCyan, "4ec9b0") },
      { token: "function", foreground: hex(c.terminalBlue, "dcdcaa") },
      { token: "variable", foreground: hex(c.textPrimary, "9cdcfe") },
      { token: "constant", foreground: hex(c.terminalYellow, "b5cea8") },
    ],
    colors: {
      "editor.background": hex(c.bgPrimary, "#1e1e2e"),
      "editor.foreground": hex(c.textPrimary, "#d4d4d4"),
      "editorCursor.foreground": hex(c.accent, "#aeafad"),
      "editor.lineHighlightBackground": hex(c.surfaceHover, "#2a2a2a"),
      "editorLineNumber.foreground": hex(c.textMuted, "#6e7681"),
      "editorLineNumber.activeForeground": hex(c.textSecondary, "#c6c6c6"),
      "editor.selectionBackground": hex(c.terminalSelection, "#264f78"),
      "editor.inactiveSelectionBackground": hex(c.surfaceActive, "#3a3d41"),
      "editorIndentGuide.background1": hex(c.surfaceHover, "#404040"),
      "editorIndentGuide.activeBackground1": hex(c.textMuted, "#707070"),
      "editorBracketHighlight.foreground1": hex(c.terminalYellow, "#ffd700"),
      "editorBracketHighlight.foreground2": hex(c.terminalMagenta, "#da70d6"),
      "editorBracketHighlight.foreground3": hex(c.terminalCyan, "#179fff"),
      "editorBracketHighlight.foreground4": hex(c.terminalGreen, "#7ee787"),
      "editorBracketHighlight.foreground5": hex(c.terminalBlue, "#79c0ff"),
      "editorBracketHighlight.foreground6": hex(c.terminalRed, "#ff7b72"),
      "editorWidget.background": hex(c.bgElevated, "#252526"),
      "editorWidget.border": hex(c.borderColor, "#454545"),
      "editorGutter.background": hex(c.bgPrimary, "#1e1e2e"),
    },
  });
  return name;
}
