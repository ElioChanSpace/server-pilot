#!/usr/bin/env node
/**
 * 生成托盘图标 PNG（单一设计源：design/tray-icon.svg）
 *
 * - src-tauri/icons/tray-template.png  白色 RGBA（macOS template 渲染，纯白/纯黑自适应）
 * - src-tauri/icons/tray-dark.png      深色 RGBA（Windows/Linux 浅色任务栏可读）
 *
 * 产物提交入库，构建/CI 不依赖本脚本。重新设计图标后运行：
 *   npm run gen:tray-icon
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "design", "tray-icon.svg");
const outDir = join(root, "src-tauri", "icons");

const SIZE = 44;
const WHITE = "#FFFFFF";
const DARK = "#2b313b";

const svg = readFileSync(svgPath, "utf8");

mkdirSync(outDir, { recursive: true });

const render = (svgSource, outName) => {
  const resvg = new Resvg(svgSource, {
    fitTo: { mode: "width", value: SIZE },
    background: "rgba(0,0,0,0)",
  });
  const png = resvg.render().asPng();
  writeFileSync(join(outDir, outName), png);
  console.log(`✔ ${outName}  ${SIZE}×${SIZE}  ${png.length} bytes`);
};

if (!svg.includes(WHITE)) {
  console.error(`设计源中未找到颜色占位 ${WHITE}，请检查 design/tray-icon.svg`);
  process.exit(1);
}

render(svg, "tray-template.png");
render(svg.replaceAll(WHITE, DARK), "tray-dark.png");
