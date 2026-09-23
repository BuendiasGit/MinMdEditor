// src/App.tsx —— 应用主组装
//
// 整体架构位置：
//   应用的顶层组件，持有所有跨模块状态并把它们接起来：
//     - src/editor/setup.ts  创建/装配 CodeMirror 编辑器
//     - src/sidebar/FileTree.tsx  侧边栏文件树
//     - src/lib/fs.ts        调 Rust 命令（打开文件夹 / 读写文件）
//     - src/theme/          主题状态与持久化
//
// 状态流：
//   theme  → 根元素 class（theme-light/dark）+ 编辑器扩展重新装配
//   rootDir → 文件树根；currentFile → 当前打开文件（保存目标）
//   dirty  → 编辑器内容是否有未保存修改（⌘S 保存）
//   cursor → 状态栏显示的行列号
//
// 编辑器配置用 ref 持有（configRef）：keymap 里的 onSave / onOpenFolder
// 在创建时捕获闭包，通过 ref 保证永远拿到最新的回调。

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
import { FileTree } from "./sidebar/FileTree";
import { readFile, writeFile } from "./lib/fs";
import sampleMd from "../demo/sample.md?raw";
import {
  loadLastFile,
  loadRootDir,
  loadTheme,
  saveLastFile,
  saveRootDir,
  saveTheme,
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

function App() {
  // 浏览器调试入口：URL 带 ?demo=1 时不依赖 Tauri 环境直接预览演示文件
  const isDemo = new URLSearchParams(window.location.search).has("demo");

  // ---- 跨模块状态 ----
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
  const [rootDir, setRootDir] = useState<string | null>(() => loadRootDir());
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState({ line: 1, col: 0 });

  // ---- 编辑器 refs ----
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ReturnType<typeof createEditorView> | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const configRef = useRef<EditorConfig | null>(null);

  /** 保存当前文件（⌘S / 标题栏按钮） */
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

  /** 编辑器更新回调：跟踪脏状态与光标行列 */
  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    if (update.docChanged) {
      const isOpenFile = update.transactions.some((t) =>
        t.isUserEvent("openFile"),
      );
      if (!isOpenFile) setDirty(true);
    }
    if (update.docChanged || update.selectionSet) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      setCursor({ line: line.number, col: head - line.from });
    }
  }, []);

  // ---- 挂载时创建编辑器（只创建一次，主题变化走 reconfigure） ----
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const config: EditorConfig = {
      theme,
      baseDir: "",
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

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeName = prev === "light" ? "dark" : "light";
      saveTheme(next);
      return next;
    });
  }, []);

  const fileName = currentFile ? basename(currentFile) : null;

  return (
    <div className={`app theme-${theme}`}>
      {/* 标题栏（可拖拽窗口；按钮不是拖拽区） */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-title" data-tauri-drag-region>
          MinMdEditor
        </div>
        <div className="titlebar-actions">
          <button onClick={openFolder} title="打开文件夹（⌘O）">
            打开文件夹
          </button>
          <button onClick={saveFile} disabled={!currentFile || !dirty} title="保存（⌘S）">
            保存
          </button>
          <button onClick={toggleTheme} title="切换黑白主题">
            {theme === "light" ? "深色" : "浅色"}
          </button>
        </div>
      </header>

      {/* 主体：侧边栏 + 编辑器 */}
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
              点击右上角「打开文件夹」开始编辑。
            </div>
          )}
        </aside>
        <main className="editor-area">
          <div className="editor-container" ref={editorContainerRef} />
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>{fileName ?? "未打开文件"}</span>
        <span className="statusbar-right">
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
