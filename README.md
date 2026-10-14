# Server Pilot

<div align="center">

**一款基于 Tauri 的桌面端服务器管理工具：SSH 终端（多标签/分屏/会话恢复）、Monaco 远程编辑器、双栏文件管理与 10+ 运维工具箱。**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Tauri](https://img.shields.io/badge/Tauri-2.11-orange)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Rust](https://img.shields.io/badge/Rust-2021-orange)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 功能特性

### 终端
- **多标签终端**：VS Code 式标签（拖拽重排、固定置顶、8 色配色、双击重命名、`⌘⇧[` `⌘⇧]` / `⌘⌥1-9` 快捷切换、中键关闭）
- **终端分屏**：`⌘D` 向右 / `⌘⇧D` 向下拆分同标签多面板，拖拽分隔条调比例，点击聚焦、面板级关闭
- **会话恢复**：页面刷新后自动恢复全部终端标签（原 ID 不变）与历史输出回放，后台长任务不中断；同一服务器可开多个独立终端
- **标签徽标**：实时显示远端当前目录、Git 分支、负载
- **路径联动**：终端 `cd` / 切换标签时文件面板自动跟随；文件面板右键「在终端中 cd 到此处」反向同步
- **可靠性**：PTY 输出 UTF-8 安全处理、空闲断连保护、主机密钥指纹确认、连接中断自动提示
- 命令历史（时间倒序、持久化）、xterm.js 搜索（`⌘F`）、拖拽文件到终端即上传到当前目录

### 远程编辑器（Monaco · VS Code 同源内核）
- **编辑体验**：语法高亮（约 40 种语言）、代码折叠、彩虹括号、缩进引导、多光标、列选择、minimap、Sticky Scroll
- **IntelliSense**：TS/JS/JSON/CSS/HTML 内置补全/诊断/悬停
- **多标签工作区**：一窗多文件、每文件独立 undo、脏点标记、`⌘S` 保存
- **保存安全**：保存状态四态（已修改/保存中/已同步/失败重试）、**远端冲突检测**（mtime+size，覆盖/放弃并重载/取消）、关闭三态确认、失败可导出本地
- **VS Code 外壳**：面包屑（点击复制路径）、`⌘P` 快速打开、`⌘⇧P` 命令面板、查找替换控件
- **vim 键位模式**（monaco-vim，状态栏指示）、只读模式、换行/Minimap 开关

### 文件管理
- **双栏文件管理器**：本地/远程并排浏览、目录下钻、面包屑、拖拽分隔
- **传输**：上传（文件/整目录）、下载、拖拽到终端上传、**传输历史**（速度/耗时、批量删除、SQLite 持久化）
- 远程文件操作：新建目录、重命名、删除、编辑（跳转 Monaco）

### 工具箱（右键终端标签）
- **进程管理**：ps 列表（排序/搜索）、SIGTERM/KILL/STOP/CONT、自动刷新
- **磁盘分析**：df 使用率 → du 逐级下钻 → 大文件扫描
- **系统信息**：内核/架构/CPU/负载/内存/Swap 信息卡
- **网络连接**：ss 全量连接表（状态过滤/搜索）
- **实时日志**：字节偏移增量 tail、过滤、自动滚动、日志轮转检测
- **定时任务**：Cron（用户/root/crontab/cron.d）+ Systemd Timers
- **资源历史**：CPU/内存/磁盘/负载趋势曲线（SVG 图表、SQLite 采样 30 天）
- **端口监测 / Docker 管理 / 服务管理**：监听端口、容器启停/日志、systemd 服务启停/日志

### SSH 与安全
- 密码 / **SSH 密钥**认证（含密钥生成与管理）
- **SSH 隧道管理**：本地/远程端口转发
- 凭据存 macOS **钥匙串**；配置本地 JSON + SQLite 持久化
- 远端命令全链路安全：标识符白名单、shell 转义、探测命令防注入/防拼接

### 界面
- **多主题**：深色/浅色/午夜黑/护眼/Monokai/Dracula/Solarized/Nord + **琉璃（透明玻璃拟态）**，自定义主题导入导出
- 系统托盘、桌面通知、应用/远程日志面板、全屏提示

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri](https://tauri.app/) 2 |
| 前端框架 | [React](https://react.dev/) 18 + TypeScript |
| 构建工具 | [Vite](https://vitejs.dev/) 5 |
| 后端语言 | Rust 2021 Edition |
| 编辑器内核 | [Monaco](https://github.com/microsoft/monaco-editor)（VS Code 同源）+ monaco-vim |
| 终端模拟 | [xterm.js](https://xtermjs.org/) 5 + fit/search addon |
| PTY 支持 | [portable-pty](https://github.com/wez/wezterm/tree/main/pty) |
| SSH / SFTP | [russh](https://crates.io/crates/russh) + russh-sftp（连接池复用） |
| 本地数据库 | rusqlite（命令/传输历史、指标采样） |
| 图表 | Recharts + 零依赖 SVG 折线图 |
| 拖拽 | @dnd-kit（分类树、终端标签） |
| 异步运行时 | Tokio 1 |
| 日志系统 | log4rs 1.4 |

---

## 项目架构

后端采用分层结构：

```text
src-tauri/src/servers/
├── domain/           # 领域层：Server、Category、Session、Settings 模型
├── application/      # 应用层：AppState 状态协调
├── infrastructure/   # 基础设施层：文件存储、SQLite、SSH/PTY 会话管理
└── interface/        # 接口层：Tauri commands（工具箱/编辑器/传输等）
```

前端主要结构：

```text
src/
├── components/       # 终端、标签栏、文件管理、工具箱、编辑器工作区等 UI
├── editor/           # Monaco 内核（env/theme/language/工作区）
├── hooks/            # 会话输出、命令历史、文件上传、剪贴板等 Hooks
├── utils/            # 主题、会话恢复、路径等工具
└── App.tsx           # 全局布局、会话编排、事件分发
```

---

## 快速开始

### 前置依赖

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.77
- [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)：按当前操作系统安装原生依赖
- 本机需安装可用的 OpenSSH 客户端（终端会话使用系统 `ssh`）

### 安装与运行

```bash
git clone https://github.com/your-username/server-pilot.git
cd server-pilot
npm install
npm run tauri dev
```

### 构建发行包

```bash
npm run tauri build
```

构建产物默认位于 `src-tauri/target/release/bundle/`。

若 CI 环境变量注入 shell 导致 `--ci` 报错：

```bash
CI=false npm run tauri build
```

> macOS 提示：如遇 `linking with cc failed`（Xcode 许可证未同意），
> 执行 `sudo xcodebuild -license accept`，或构建前 `source scripts/macos-build-env.sh`。

### GitHub 自动编译

- `CI` 工作流：推送 `main` / `master` 或 PR 时执行前端构建与 Rust 检查
- `Build Tauri App` 工作流：Actions 页面手动触发，或推送 `v1.0.0` 形式 tag 自动触发，产物自动上传并在 tag 构建时创建 Draft Release

---

## 使用说明

1. **管理服务器**：顶部菜单「文件」或左侧树右键创建分类/服务器；支持从 `~/.ssh/config` 导入
2. **连接终端**：双击服务器或右键连接；右键标签进入「工具箱」打开各项运维面板
3. **多标签/分屏**：右键标签固定/配色/重命名；`⌘D` 分屏；拖拽调序
4. **编辑远程文件**：文件管理器双击文件 → Monaco 编辑器（多标签、`⌘S` 保存、冲突检测）
5. **路径联动**：右键标签开启「跟随终端目录」，终端 `cd` 即可带面板跳转
6. **传输文件**：底部文件传输面板上传/下载，或拖拽文件到终端上传至当前目录
7. **会话恢复**：刷新页面后终端标签与历史输出自动恢复（设置中可关闭）

### 已知边界

- 服务器端以 **Linux** 为主（Windows 服务器暂不支持）
- 终端会话经系统 `ssh` 建立；文件/监控/工具箱能力经 russh（SFTP/exec）执行
- 监控与工具箱依赖服务器自带命令（ps/ss/df/du/systemctl 等），无需安装代理
- 语法高亮未收录的格式（如 Makefile/Haskell）按纯文本显示

---

## Roadmap

- [x] SSH 密钥认证与密钥管理
- [x] Monaco 多标签远程编辑器（冲突检测 / vim 键位 / 命令面板）
- [x] 终端分屏、标签管理、会话恢复与输出回放
- [x] 工具箱全套（进程/磁盘/网络/日志/定时任务/资源历史/Docker/服务）
- [ ] 会话日志落盘 + 跨会话搜索
- [ ] 终端 Triggers / 关键词高亮
- [ ] 命令片段库 + 参数化模板
- [ ] 目录同步（增量/镜像，差异预览）
- [ ] Zmodem/Trzsz 终端内文件传输
- [ ] SSH 高级连接（ControlMaster / Agent Forwarding / SOCKS5）
- [ ] 配置云同步（Gist / WebDAV）
- [ ] 更完整的 Windows 服务器支持

---

## License

[MIT](LICENSE)
