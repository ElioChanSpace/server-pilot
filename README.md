# 🖥️ Server Pilot

<div align="center">

**一款基于 Tauri 的轻量级跨平台 SSH 服务器管理工具**

*A lightweight, cross-platform SSH server manager built with Tauri*

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Tauri](https://img.shields.io/badge/Tauri-1.5-orange)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Rust](https://img.shields.io/badge/Rust-2021-orange)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## ✨ 功能特性

- 🗂️ **分类管理** — 支持多级分类树，将服务器按项目或环境分组管理
- 🔌 **SSH 连接** — 通过系统 `ssh` 命令建立连接，支持密码认证
- 💻 **内置终端** — 基于 xterm.js 的全功能终端模拟器，支持 PTY resize
- 📑 **多会话标签** — 同时管理多个并发 SSH 会话，Tab 切换无缝衔接
- 📊 **仪表盘** — 服务器信息可视化（借助 Recharts）
- 📋 **日志查看器** — 内置连接日志查看，快速排查连接问题
- 🖱️ **右键菜单** — 在侧边栏对服务器/分类进行快捷操作（断开连接、新建等）
- 💾 **持久化存储** — 数据以 JSON 格式保存在本地应用目录，重启不丢失

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri](https://tauri.app/) 1.5 |
| 前端框架 | [React](https://react.dev/) 18 + TypeScript |
| 构建工具 | [Vite](https://vitejs.dev/) 5 |
| 后端语言 | Rust 2021 Edition |
| 终端模拟 | [xterm.js](https://xtermjs.org/) 5 + xterm-addon-fit |
| PTY 支持 | [portable-pty](https://github.com/wez/wezterm/tree/main/pty) 0.8 |
| 图表库 | [Recharts](https://recharts.org/) 2 |
| 异步运行时 | Tokio 1 |
| 日志系统 | log4rs 1.4 |

---

## 🏗️ 项目架构

后端采用清晰的分层架构（Clean Architecture）：

```
src-tauri/src/servers/
├── domain/           # 领域层 — 模型定义 (Server, Category) 与 Repository 接口
├── application/      # 应用层 — AppState，协调业务逻辑
├── infrastructure/   # 基础设施层 — 文件持久化 & PTY 会话管理
└── interface/        # 接口层 — Tauri 命令处理器 (commands.rs)
```

前端组件结构：

```
src/
├── components/       # UI 组件（侧边栏、终端、仪表盘、模态框等）
├── context/          # React Context（ServerContext, TerminalContext）
├── hooks/            # 自定义 Hooks
└── App.tsx           # 根组件，负责全局布局与事件路由
```

---

## 🚀 快速开始

### 前置依赖

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.70
- [Tauri CLI 依赖](https://tauri.app/v1/guides/getting-started/prerequisites/)（操作系统原生依赖，按平台安装）

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/server-pilot.git
cd server-pilot

# 2. 安装前端依赖
npm install

# 3. 启动开发模式（含热重载）
npm run tauri dev
```

### 构建发行包

```bash
npm run tauri build
```

构建产物将生成在 `src-tauri/target/release/bundle/` 目录下。

---

## 📖 使用说明

1. **添加分类** — 通过菜单栏 `File > New Category` 或右键侧边栏空白处，创建服务器分组。
2. **添加服务器** — 通过 `File > New Server` 填写主机名、端口、用户名等信息，将服务器加入指定分类。
3. **连接服务器** — 在左侧服务器列表中**双击**目标服务器即可发起 SSH 连接。
4. **多会话管理** — 多个已连接服务器将以 Tab 形式展示在主内容区顶部，点击切换。
5. **断开连接** — 点击 Tab 上的关闭按钮，或右键服务器选择 `Disconnect`。

> ⚠️ **注意**：当前版本仅支持 Linux 服务器的 SSH 连接，使用系统内置 `ssh` 命令，需确保本机已安装 OpenSSH 客户端。

---

## 📋 Tauri 命令列表

| 命令 | 说明 |
|------|------|
| `create_server` | 创建并持久化一条服务器记录 |
| `get_servers` | 获取所有服务器列表 |
| `create_category` | 创建分类 |
| `get_categories` | 获取所有分类 |
| `connect_server` | 建立 SSH/PTY 会话 |
| `pty_write` | 向终端写入数据 |
| `pty_resize` | 调整终端尺寸 |
| `disconnect_server` | 关闭指定会话 |

---

## 🗺️ Roadmap

- [ ] SSH 密钥认证支持
- [ ] Windows / Linux 平台完整测试
- [ ] 服务器编辑 & 删除
- [ ] 分类拖拽排序
- [ ] 服务器实时性能监控（CPU / 内存 / 磁盘）
- [ ] SFTP 文件传输
- [ ] 连接配置导入 / 导出

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送分支 (`git push origin feat/amazing-feature`)
5. 发起 Pull Request

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
