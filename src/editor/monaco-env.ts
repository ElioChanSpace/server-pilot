// Monaco 运行环境：必须在任何 monaco.editor.create 之前加载。
// Vite 下用 ?worker 后缀注入 worker 构造器（实现 getWorker，而非 getWorkerUrl）。
// 注意 monaco-editor 的 exports 映射：monaco-editor/<sub> → esm/vs/<sub>.js，
// 导入路径不带 esm/vs 前缀。
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

(
  globalThis as unknown as {
    MonacoEnvironment?: monaco.Environment;
  }
).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new editorWorker();
    }
  },
};

export { monaco };
