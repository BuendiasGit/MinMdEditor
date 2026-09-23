# MinMdEditor

**个人项目**：自用、最小、可扩展的桌面端 Markdown 编辑器。

Live Preview（实时预览）式编辑：编辑器**全程保持渲染态**——语法标记
（`#`、`**`、`*`、`` ` ``、`[]()` 等）隐藏，直接看到格式化效果；文档在内存中
始终是纯 Markdown 文本，渲染由 CodeMirror 6 的 **Decoration 系统**完成
（不转 HTML 段落方案，不引入 Tiptap / ProseMirror）。

## 支持环境（当前版本）

| 项 | 说明 |
|---|---|
| 操作系统 | **macOS（Apple Silicon / M 系列芯片）**，Intel Mac 暂不支持 |
| 架构 | `aarch64`（安装包：`MinMdEditor_0.1.0_aarch64.dmg`） |
| 开发环境 | Node.js ≥ 20、Rust 工具链（rustc + cargo）、Xcode Command Line Tools |
| 运行模式 | 桌面应用（Tauri 2 壳）+ 浏览器调试（`npm run tauri dev` 后访问 `http://localhost:1420/?demo=1`） |

## 技术栈

- 桌面框架：Tauri 2（Rust 后端）
- 前端：React + TypeScript + Vite
- 编辑器核心：CodeMirror 6（Decoration / Widget / StateField）
- 渲染模式：Live Preview（文档在内存中始终是纯 Markdown 文本）

## 功能（最小可用范围）

核心四件事，外加迭代扩展：

1. **文件读写**：`⌘O` / 菜单「文件 → 打开文件夹」打开本地文件夹 → 侧边栏文件树
   （只显示 `.md` / `.markdown`，自动忽略 `.git`、`node_modules`、`target` 等）；
   `⌘S` 保存回原文件；文件树支持收起/展开（侧边栏把手）
2. **Live Preview**：标题（#～######）、加粗、斜体、行内代码、代码块（语法高亮）、
   引用、无序/有序列表、链接、图片（Widget 渲染真实图像）、分隔线
3. **打字机模式**：光标越出舒适视区（上方 45% / 下方 55%）时把光标行**平滑滚动**
   到屏幕垂直中间（文档末尾也通过底部留白支持居中）；菜单「编辑 → 打字机模式」开关
4. **黑白主题**：CSS 变量驱动，标题栏（透明）/ 侧边栏 / 编辑器 / 状态栏同步变化；
   设置面板可选字体（9 种）与字号（13–20）

迭代扩展：

- 屏幕顶层菜单（macOS 菜单栏，页面上无任何按钮）：文件 / 编辑 / 设置
- 标题快捷键：`⌘1` ～ `⌘6`（同级别再按还原正文）
- 状态栏字数统计：总字数 / 中文字数 / 英文字数
- 编辑区右键 → **横向格式工具栏**：加粗 / 斜体 / 删除线 / 正文 / 标题（H1–H6 下拉）
- 文件树右键菜单：空白处新建文件 / 新建文件夹；文件重命名 / 删除；文件夹新建子文件
- 侧边栏禁复制（仅文件名可选中复制）
- 应用图标：复用自同目录 MdEditor 项目（`src-tauri/icons/`）

## 局限性（已知）

- **未签名、未公证**：本地构建，无 Apple Developer 签名 / 公证。
  首次打开会被 macOS Gatekeeper 拦截（提示"无法验证开发者"），
  需右键 → 打开，或在 系统设置 → 隐私与安全性 中放行。
- **仅支持 Apple Silicon**：当前构建为 `aarch64`，Intel Mac 无法运行；
  如需分发需补 x86_64 / Universal 构建。
- **无自动更新**：版本更新需手动重新分发安装包。
- **只支持 Markdown**：文件树与打开文件仅限 `.md` / `.markdown`；
  不支持其它格式（刻意如此，保持最小）。
- **无云同步 / 协作 / 插件市场**：纯本地单机工具（刻意不做）。
- **无托盘 / 无多窗口**：单窗口设计。
- **打字机关闭时的行为**：底部留白（50vh 用于最后一行居中）会随开关移除。

## 开发

```bash
npm install
npm run tauri dev     # 开发模式（自动编译 Rust 并打开应用窗口）
npm run tauri build   # 打包发布产物（app + dmg）
```

浏览器调试：`npm run tauri dev` 启动后访问 `http://localhost:1420/?demo=1`
（无需 Tauri 环境即可预览渲染效果，但文件系统操作不可用）。

## 项目结构

```
src/
├── editor/            # CodeMirror 6 相关
│   ├── setup.ts       # 编辑器初始化（扩展装配、打开文件）
│   ├── livePreview.ts # Decoration 逻辑（核心：隐藏语法标记 + Widget 渲染）
│   ├── typewriter.ts  # 打字机模式（45%–55% 舒适区）
│   ├── headings.ts    # ⌘1–⌘6 标题命令
│   └── theme.ts       # 编辑器主题（EditorView.theme 动态生成）
├── sidebar/           # 文件树（右键菜单：新建/重命名/删除）
├── theme/             # 全局主题变量（theme.css + TS 侧定义）
├── lib/               # 桥接层：fs（Rust 命令封装）/ menu / wordCount
└── App.tsx            # 装配：菜单分发 / 设置面板 / 编辑器 / 状态栏

src-tauri/
├── src/
│   ├── lib.rs         # 注册全部命令
│   ├── commands/      # 文件系统命令（list_dir / read_file / write_file
│   │                  #   / create_file / create_folder / rename_path / delete_path）
│   └── menu.rs        # 原生屏幕顶层菜单（文件 / 编辑 / 设置）
└── tauri.conf.json
```
