// 后端 detect_language 的语言标识 → Monaco 语言 id。
// Monaco 不认识的（nginx/vim/lisp/haskell 等）退化为纯文本或最接近者。
const LANGUAGE_MAP: Record<string, string> = {
  json: "json",
  yaml: "yaml",
  toml: "ini",
  html: "html",
  css: "css",
  javascript: "javascript",
  typescript: "typescript",
  jsx: "javascript",
  python: "python",
  ruby: "ruby",
  rust: "rust",
  go: "go",
  java: "java",
  c: "cpp",
  cpp: "cpp",
  csharp: "csharp",
  shellscript: "shell",
  lua: "lua",
  sql: "sql",
  markdown: "markdown",
  ini: "ini",
  dockerfile: "dockerfile",
  terraform: "hcl",
  elixir: "elixir",
  erlang: "erlang",
  r: "r",
  // Monaco 无对应 grammar 的，保持可读的纯文本
  "plain text": "plaintext",
  nginx: "ini",
  vim: "plaintext",
  lisp: "plaintext",
  haskell: "plaintext",
  makefile: "plaintext",
  gitignore: "plaintext",
  protobuf: "plaintext",
  graphql: "plaintext",
};

export function toMonacoLanguage(language: string, path: string): string {
  const key = language.trim().toLowerCase();
  if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
  // 按扩展名兜底（后端未识别时）
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  const EXT_MAP: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    xml: "xml",
    sql: "sql",
    lua: "lua",
    toml: "ini",
  };
  return EXT_MAP[ext] ?? "plaintext";
}
