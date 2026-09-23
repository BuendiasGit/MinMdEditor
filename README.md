# MinMdEditor

自用、最小、可扩展的桌面端 Markdown 编辑器。Live Preview（实时预览）式编辑：
光标所在行显示 Markdown 源码，其余行渲染为格式化文本。

## 技术栈

- 桌面框架：Tauri 2（Rust 后端）
- 前端：React + TypeScript + Vite
- 编辑器核心：CodeMirror 6
- 渲染模式：Live Preview（基于 CodeMirror 6 的 Decoration 系统，文档在内存中始终是纯 Markdown 文本）

## 功能

- 打开本地文件夹，侧边栏展示文件树（只显示 `.md` / `.markdown`，自动忽略 `.git`、`node_modules`、`target` 等目录）
- 点击文件在编辑器中打开，`⌘S` 保存回原文件，`⌘O` 打开文件夹
- Live Preview：支持标题（# ～ ######）、加粗、斜体、行内代码、代码块（带语法高亮）、引用、无序/有序列表、链接、图片（真实渲染）、分隔线
- 打字机模式：光标所在行保持在屏幕垂直方向中间（舒适视区 30% ~ 70%）
- 黑白主题切换（CSS 变量驱动，标题栏 / 侧边栏 / 编辑器 / 状态栏同步变化）

## 开发

前置要求：Node.js ≥ 20、Rust 工具链（rustc + cargo）、macOS 上需要 Xcode Command Line Tools。

```bash
npm install
npm run tauri dev     # 开发模式（自动编译 Rust 并打开应用窗口）
npm run tauri build   # 打包发布产物
```

## 项目结构

```
src/
├── editor/            # CodeMirror 6 相关
│   ├── setup.ts       # 编辑器初始化（扩展装配、打开文件）
│   ├── livePreview.ts # Decoration 逻辑（核心：隐藏语法标记 + Widget 渲染）
│   ├── typewriter.ts  # 打字机模式
│   └── theme.ts       # 编辑器主题（EditorView.theme 动态生成）
├── sidebar/           # 文件树
├── theme/             # 全局主题变量（theme.css + TS 侧定义）
├── lib/fs.ts          # 前端调 Rust 文件命令的封装
└── App.tsx            # 应用主组装
src-tauri/
├── src/
│   ├── lib.rs         # Tauri 入口（注册命令与插件）
│   └── commands/      # 文件读写命令（list_dir / read_file / write_file）
└── tauri.conf.json
```

## 设计说明

- 不引入 UI 组件库、不用分栏预览、不做云同步/协作/插件市场
- 文档在内存中始终是纯 Markdown 字符串；语法树（@lezer/markdown）只用于定位语法区间，不是数据源
- 图片通过 Tauri asset 协议（`assetProtocol`）加载本地文件，远程图片直接加载
- 打开文件夹路径与主题选择会持久化在 localStorage，重启自动恢复
