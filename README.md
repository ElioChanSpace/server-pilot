# Server Pilot

<div align="center">

**一款基于 Tauri 的桌面端服务器管理工具，集成 SSH 终端、多会话管理、文件传输、监控与日志面板。**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Tauri](https://img.shields.io/badge/Tauri-1.5-orange)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Rust](https://img.shields.io/badge/Rust-2021-orange)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 功能特性

- 多级分类管理：支持树形分类与未分类分组，适合按项目、环境或业务域管理服务器
- SSH 连接与会话管理：通过系统 `ssh` 建立连接，支持密码认证，并能正确识别连接中与已连接状态
- 多终端标签：支持同时打开多个服务器终端，切换标签时右侧服务器详情会同步联动
- 内置终端：基于 `xterm.js` 的终端体验，支持 PTY 写入与窗口尺寸同步
- 服务器详情面板：右侧按概览和监控分区展示服务器信息，默认关闭，可按需展开
- 性能监控：对 Linux 服务器采集 CPU、内存、GPU 与高占用进程信息，并展示趋势图
- 文件传输托盘：底部独立文件传输模块，支持上传、下载和远程目录浏览
- 多级远程文件浏览：支持目录树、面包屑、当前目录双栏展示，按层级选择远程文件
- 应用日志面板：应用日志以独立全宽面板显示，支持关闭，不会打断底层服务器终端
- 右键快捷操作：可在左侧树中对分类和服务器进行新建、编辑、连接、断开等快捷操作
- 本地持久化：服务器与分类配置以本地 JSON 方式保存，重启后仍可继续使用

---

## 技术栈

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

## 项目架构

后端采用分层结构：

```text
src-tauri/src/servers/
├── domain/           # 领域层：Server、Category 模型与仓储接口
├── application/      # 应用层：AppState，负责状态协调
├── infrastructure/   # 基础设施层：本地文件存储、SSH/PTy 会话管理
└── interface/        # 接口层：Tauri commands
```

前端主要结构：

```text
src/
├── components/       # 侧边栏、终端、详情、监控、日志、文件传输等 UI 组件
├── context/          # React Context（ServerContext）
├── hooks/            # 自定义 Hooks
└── App.tsx           # 全局布局、面板开关、会话与菜单入口
```

---

## 快速开始

### 前置依赖

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.70
- [Tauri CLI 依赖](https://tauri.app/v1/guides/getting-started/prerequisites/)：按当前操作系统安装原生依赖
- 本机需安装可用的 OpenSSH 客户端

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

### GitHub 自动编译

- `CI` 工作流会在推送到 `main` / `master` 或提交 Pull Request 时自动执行前端构建和 Rust 检查。
- `Build Tauri App` 工作流支持两种触发方式：
  - 在 GitHub Actions 页面手动触发
  - 推送形如 `v1.0.0` 的 tag 自动触发
- 打包完成后会自动上传构建产物，并在 tag 构建时创建 Draft Release。

---

## 使用说明

1. 新建分类：通过顶部菜单“文件 -> 新建分类...”或左侧分类右键菜单创建多级分组
2. 新建服务器：在“文件 -> 新建服务器...”中填写名称、主机、端口、用户名、密码和所属分组
3. 连接服务器：在左侧服务器树中双击服务器，或使用右键菜单发起连接
4. 切换终端：连接成功后会在顶部生成终端标签，多个会话可并行切换
5. 查看详情：需要时展开右侧服务器信息栏，查看概览与监控信息
6. 传输文件：打开底部文件传输面板，在远程目录树中浏览并选择文件后执行上传或下载
7. 查看日志：通过顶部菜单“系统 -> 查看日志”打开应用日志面板；日志面板可独立关闭，不会影响当前终端

### 文件传输说明

- 当前文件传输基于 `scp`
- 当前远程目录浏览与文件传输主要面向 Linux 服务器
- 若服务器未保存密码，则无法直接执行上传下载

### 监控说明

- 当前性能监控仅支持 Linux 服务器
- 监控面板支持 CPU、内存、GPU 与高占用进程展示
- 若服务器未连接，则监控面板仅显示待连接提示

---

## Tauri 命令列表

| 命令 | 说明 |
|------|------|
| `create_server` | 创建服务器记录 |
| `update_server` | 更新服务器配置 |
| `get_servers` | 获取服务器列表 |
| `create_category` | 创建分类 |
| `get_categories` | 获取分类列表 |
| `connect_server` | 建立 SSH / PTY 会话 |
| `pty_write` | 向终端写入数据 |
| `pty_resize` | 调整终端尺寸 |
| `disconnect_server` | 断开会话连接 |
| `fetch_server_metrics` | 获取服务器性能监控数据 |
| `list_remote_directory` | 按路径列出远程目录内容 |
| `upload_file_to_server` | 上传本地文件到服务器 |
| `download_file_from_server` | 从服务器下载文件到本地 |

---

## 当前限制

- SSH 连接当前以密码认证为主，暂未提供 SSH 密钥管理界面
- 文件传输与监控能力当前主要支持 Linux 服务器
- 应用日志目前仍以示例日志与应用内日志查看为主，未做更完整的筛选与检索

---

## Roadmap

- [ ] SSH 密钥认证支持
- [ ] 更完整的 Windows 连接与功能支持
- [ ] 服务器删除能力
- [ ] 分类拖拽排序
- [ ] 监控指标扩展到磁盘、网络等维度
- [ ] 文件传输队列与批量操作
- [ ] 连接配置导入 / 导出

---

## 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feat/amazing-feature`
5. 发起 Pull Request

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
