// src/App.tsx —— 应用主组装
//
// 整体架构位置：
//   应用的顶层组件，持有所有跨模块状态并把它们接起来：
//     - src/editor/setup.ts  创建/装配 CodeMirror 编辑器
//     - src/sidebar/FileTree.tsx  侧边栏文件树
//     - src/lib/fs.ts        调 Rust 命令（读写文件）
//     - src/lib/menu.ts      屏幕顶层菜单事件桥（菜单本体在 Rust 侧）
//     - src/theme/           主题 / 字体字号 / 设置持久化
//
// 交互入口（页面上没有任何按钮）：
//   所有操作都从屏幕顶层菜单进入（macOS 菜单栏）：
//     MinMdEditor → About / 退出
//     文件       → 打开文件夹 / 打开文件
//     编辑       → 正文 / 一级~六级标题 / 打字机模式（开关）
//     设置       → 设置…（打开右侧设置面板）/ 显示文件侧边栏（开关）
//   快捷键：⌘O 打开文件夹、⌘S 保存、⌘1~⌘6 标题（编辑器 keymap，见 setup.ts）
//
// 状态流：
//   theme      → 根元素 class（theme-light/dark）+ 编辑器扩展重新装配
//   settings   → 字体/字号写入根元素 CSS 变量；侧边栏折叠/打字机开关同步菜单
//   rootDir    → 文件树根；currentFile → 当前打开文件（保存目标）
//   dirty      → 是否有未保存修改（⌘S 保存）
//   cursor     → 状态栏显示的行列号
//   settingsOpen → 右侧设置面板是否展开

import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { StateEffect } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import {
  buildExtensions,
  createEditorView,
  openDocument,
  type EditorConfig,
} from "./editor/setup";
import { applyHeading } from "./editor/headings";
import { FileTree } from "./sidebar/FileTree";
import { readFile, writeFile } from "./lib/fs";
import { countWords, type WordCount } from "./lib/wordCount";
import { onMenuCommand, setMenuItemChecked } from "./lib/menu";
import sampleMd from "../demo/sample.md?raw";
import {
  loadLastFile,
  loadRootDir,
  loadSettings,
  loadTheme,
  saveLastFile,
  saveRootDir,
  saveSettings,
  saveTheme,
  type AppSettings,
  type ThemeName,
} from "./theme";
import "./theme/theme.css";
import "./App.css";

/** 取路径的目录部分（用于图片相对路径解析） */
function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

/** 取文件名（用于标题栏 / 状态栏显示） */
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 设置面板里的字体选项（存的是 CSS font-family 字符串） */
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "系统默认", value: "" },
  { label: "苹方 PingFang SC", value: '"PingFang SC", "Hiragino Sans GB", sans-serif' },
  { label: "冬青黑体 Hiragino Sans GB", value: '"Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
  { label: "宋体 Songti SC", value: '"Songti SC", "SimSun", serif' },
  { label: "楷体 Kaiti SC", value: '"Kaiti SC", "KaiTi", serif' },
  { label: "黑体 Heiti SC", value: '"Heiti SC", "SimHei", sans-serif' },
  { label: "微软雅黑 Microsoft YaHei", value: '"Microsoft YaHei", sans-serif' },
  { label: "衬线 Georgia", value: 'Georgia, "Times New Roman", serif' },
  { label: "无衬线 Helvetica Neue", value: '"Helvetica Neue", Arial, sans-serif' },
];

/** 设置面板里的字号选项（px） */
const FONT_SIZE_OPTIONS = [13, 14, 15, 16, 17, 18, 20];

function App() {
  // 浏览器调试入口：URL 带 ?demo=1 时不依赖 Tauri 环境直接预览演示文件
  const isDemo = new URLSearchParams(window.location.search).has("demo");

  // ---- 跨模块状态 ----
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [rootDir, setRootDir] = useState<string | null>(() => loadRootDir());
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState({ line: 1, col: 0 });
  const [wordCount, setWordCount] = useState<WordCount>({
    total: 0,
    chinese: 0,
    english: 0,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- 编辑器 refs ----
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ReturnType<typeof createEditorView> | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const configRef = useRef<EditorConfig | null>(null);
  // settings 的最新引用（供菜单事件回调读取，避免闭包过期）
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** 保存当前文件（⌘S / 菜单之外无按钮） */
  const saveFile = useCallback(async () => {
    const path = currentFileRef.current;
    const view = viewRef.current;
    if (!path || !view) return;
    try {
      await writeFile(path, view.state.doc.toString());
      setDirty(false);
      setStatus("已保存");
    } catch (err) {
      setStatus(`保存失败: ${err}`);
    }
  }, []);

  /** 打开文件夹（原生目录选择对话框） */
  const openFolder = useCallback(async () => {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      title: "打开文件夹",
    });
    if (!dir) return;
    const path = Array.isArray(dir) ? dir[0] : dir;
    setRootDir(path);
    saveRootDir(path);
    setStatus(`已打开文件夹`);
  }, []);

  /** 打开文件：读取 → 载入编辑器 → 更新图片目录 */
  const openFile = useCallback(async (path: string) => {
    try {
      const content = await readFile(path);
      currentFileRef.current = path;
      setCurrentFile(path);
      setDirty(false);
      setStatus(`已打开 ${basename(path)}`);
      saveLastFile(path); // 记住本次打开的文件，重启后自动恢复
      const view = viewRef.current;
      if (view) openDocument(view, content, dirname(path));
    } catch (err) {
      setStatus(`打开失败: ${err}`);
    }
  }, []);

  /** 打开单个文件（原生文件选择对话框，仅 .md / .markdown） */
  const openFileDialog = useCallback(async () => {
    try {
      const file = await openDialog({
        multiple: false,
        title: "打开文件",
        filters: [
          { name: "Markdown", extensions: ["md", "markdown"] },
        ],
      });
      if (!file) return;
      const path = Array.isArray(file) ? file[0] : file;
      void openFile(path);
    } catch (err) {
      // 浏览器 demo 下没有 Tauri 对话框，忽略并提示
      setStatus(`打开文件: ${err}`);
    }
  }, [openFile]);

  /** 编辑器更新回调：跟踪脏状态与光标行列 */
  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    if (update.docChanged) {
      const isOpenFile = update.transactions.some((t) =>
        t.isUserEvent("openFile"),
      );
      if (!isOpenFile) setDirty(true);
      // 字数统计：每次内容变化重新统计（含打开文件）
      setWordCount(countWords(update.state.doc.toString()));
    }
    if (update.docChanged || update.selectionSet) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      setCursor({ line: line.number, col: head - line.from });
    }
  }, []);

  // ---- 挂载时创建编辑器（只创建一次，主题/打字机变化走 reconfigure） ----
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const config: EditorConfig = {
      theme,
      baseDir: "",
      typewriterEnabled: settings.typewriterEnabled,
      onSave: saveFile,
      onOpenFolder: openFolder,
      onUpdate: handleEditorUpdate,
    };
    configRef.current = config;
    const view = createEditorView(container, config);
    viewRef.current = view;

    // 重启后自动恢复：有上次文件夹且记得上次文件 → 重新打开
    const last = loadLastFile();
    if (rootDir && last) {
      void openFile(last);
    } else if (isDemo) {
      // 浏览器调试入口：URL 带 ?demo=1 时直接载入演示文件（无需 Tauri 环境）
      void openDocument(view, sampleMd, "");
    }

    return () => {
      view.destroy();
      viewRef.current = null;
      configRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 主题切换：改根元素 class + 重新装配编辑器扩展 ----
  useEffect(() => {
    if (!viewRef.current || !configRef.current) return;
    const next = { ...configRef.current, theme };
    configRef.current = next;
    viewRef.current.dispatch({
      effects: StateEffect.reconfigure.of(buildExtensions(next)),
    });
  }, [theme]);

  /** 切换主题（浅色 ↔ 深色）并持久化 */
  const changeTheme = useCallback((next: ThemeName) => {
    saveTheme(next);
    setTheme(next);
  }, []);

  // ---- 设置：字体 / 字号写入根元素 CSS 变量（编辑器主题经 var() 生效） ----
  useEffect(() => {
    const root = document.documentElement;
    if (settings.editorFont) {
      root.style.setProperty("--editor-font", settings.editorFont);
    } else {
      root.style.removeProperty("--editor-font");
    }
    root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  }, [settings.editorFont, settings.editorFontSize]);

  /** 更新部分设置并持久化 */
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // ---- 打字机模式开关：reconfigure 编辑器扩展 + 回写菜单勾选 ----
  const setTypewriterEnabled = useCallback((enabled: boolean) => {
    updateSettings({ typewriterEnabled: enabled });
    setMenuItemChecked("toggle-typewriter", enabled);
    const view = viewRef.current;
    const config = configRef.current;
    if (view && config) {
      const next = { ...config, typewriterEnabled: enabled };
      configRef.current = next;
      view.dispatch({
        effects: StateEffect.reconfigure.of(buildExtensions(next)),
      });
    }
  }, [updateSettings]);

  /** 侧边栏折叠开关：持久化 + 回写菜单勾选 */
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    updateSettings({ sidebarCollapsed: collapsed });
    setMenuItemChecked("toggle-sidebar", !collapsed);
  }, [updateSettings]);

  /** 把当前行/选区设为指定级别标题（0 = 还原正文） */
  const applyHeadingCmd = useCallback((level: number) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(applyHeading(view.state, level));
  }, []);

  // ---- 屏幕顶层菜单命令分发（全局只订阅一次） ----
  useEffect(() => {
    return onMenuCommand((cmd) => {
      switch (cmd) {
        case "open-folder":
          void openFolder();
          break;
        case "open-file":
          void openFileDialog();
          break;
        case "toggle-typewriter":
          // 菜单点击 → 翻转当前打字机开关
          setTypewriterEnabled(!settingsRef.current.typewriterEnabled);
          break;
        case "open-settings":
          setSettingsOpen((open) => !open);
          break;
        case "toggle-sidebar":
          setSidebarCollapsed(!settingsRef.current.sidebarCollapsed);
          break;
        default:
          // "heading-0" ~ "heading-6"
          if (cmd.startsWith("heading-")) {
            applyHeadingCmd(Number(cmd.slice("heading-".length)));
          }
          break;
      }
    });
  }, [openFolder, openFileDialog, setTypewriterEnabled, setSidebarCollapsed, applyHeadingCmd]);

  // ---- 启动时把应用状态回写为菜单勾选（真实环境菜单已建好） ----
  useEffect(() => {
    setMenuItemChecked("toggle-typewriter", settingsRef.current.typewriterEnabled);
    setMenuItemChecked("toggle-sidebar", !settingsRef.current.sidebarCollapsed);
  }, []);

  // ---- Esc 关闭设置面板 ----
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const fileName = currentFile ? basename(currentFile) : null;

  return (
    <div
      className={`app theme-${theme}${settings.sidebarCollapsed ? " sidebar-collapsed" : ""}`}
    >
      {/* 标题栏（可拖拽窗口；页面上无任何按钮，操作全部走菜单） */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-title" data-tauri-drag-region>
          MinMdEditor
        </div>
      </header>

      {/* 主体：文件侧边栏 + 编辑器 + 右侧设置面板 */}
      <div className="body">
        <aside className="sidebar">
          {rootDir ? (
            <FileTree
              rootDir={rootDir}
              onOpenFile={openFile}
              activeFile={currentFile}
            />
          ) : (
            <div className="sidebar-empty">
              还没有打开文件夹。
              <br />
              菜单「文件 → 打开文件夹」开始编辑。
            </div>
          )}
        </aside>

        {/* 侧边栏把手：分界线上的窄条，点击收起/展开侧边栏（页面上唯一的可点元素，非按钮） */}
        <div
          className="sidebar-toggle"
          title={settings.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          onClick={() => setSidebarCollapsed(!settingsRef.current.sidebarCollapsed)}
        />

        <main className="editor-area">
          <div className="editor-container" ref={editorContainerRef} />
        </main>

        {/* 设置面板遮罩（点击关闭） */}
        <div
          className={`settings-backdrop${settingsOpen ? " open" : ""}`}
          onClick={() => setSettingsOpen(false)}
        />
        {/* 右侧设置面板：字体 / 字号 / 主题 */}
        <aside className={`settings-panel${settingsOpen ? " open" : ""}`}>
          <div className="settings-panel-title">设置</div>

          <label className="settings-row">
            <span className="settings-label">字体</span>
            <select
              value={settings.editorFont}
              onChange={(e) => updateSettings({ editorFont: e.target.value })}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-row">
            <span className="settings-label">字号</span>
            <select
              value={String(settings.editorFontSize)}
              onChange={(e) =>
                updateSettings({ editorFontSize: Number(e.target.value) })
              }
            >
              {FONT_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </select>
          </label>

          <div className="settings-row">
            <span className="settings-label">主题</span>
            <select
              value={theme}
              onChange={(e) => changeTheme(e.target.value as ThemeName)}
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
        </aside>
      </div>

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>{fileName ?? "未打开文件"}</span>
        <span className="statusbar-right">
          <span>
            总 {wordCount.total} · 中 {wordCount.chinese} · 英 {wordCount.english}
          </span>
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span>{dirty ? "未保存" : status}</span>
        </span>
      </footer>
    </div>
  );
}

export default App;
