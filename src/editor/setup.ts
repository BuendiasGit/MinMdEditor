// src/editor/setup.ts —— 编辑器初始化与扩展装配
//
// 整体架构位置：
//   src/editor/ 是 CodeMirror 6 相关代码的集合，setup.ts 是唯一入口：
//   App.tsx 只依赖这里导出的几个函数，不直接触碰 CodeMirror 细节。
//
//   buildExtensions() 把以下能力装配成一个 EditorState：
//     - Markdown 语言解析（@codemirror/lang-markdown）
//     - 实时预览 Decoration（livePreview.ts）
//     - 打字机模式（typewriter.ts）
//     - 编辑器主题（theme.ts）
//     - 快捷键（保存 ⌘S / 打开文件夹 ⌘O）与常用编辑命令
//   createEditorView() 负责创建挂在容器上的 EditorView。
//   openDocument() 把“打开文件”这件事封装成一次 dispatch：
//     替换全文 + 光标归零 + 更新图片目录 + 标记为 openFile 用户事件
//     （供脏标记/打字机识别，避免把打开文件当成用户输入）。

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import {
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { livePreviewField, setBaseDir, baseDirField } from "./livePreview";
import { typewriter } from "./typewriter";
import { headingKeymap } from "./headings";
import { editorTheme } from "./theme";
import type { ThemeName } from "../theme";

/**
 * 编辑器装配配置。
 * App 创建时传入并持有引用；theme 变化时 App 用它重新装配。
 */
export interface EditorConfig {
  theme: ThemeName;
  /** 当前打开文件所在目录（图片相对路径的解析基准） */
  baseDir: string;
  /** ⌘S 保存回调 */
  onSave?: () => void;
  /** ⌘O 打开文件夹回调 */
  onOpenFolder?: () => void;
  /** 编辑器每次更新回调（App 用它跟踪脏状态与行列号） */
  onUpdate?: (update: ViewUpdate) => void;
}

/** 把全部编辑器能力装配成扩展列表（theme 变化时整体替换） */
export function buildExtensions(config: EditorConfig): Extension[] {
  return [
    // Markdown 语法解析（@lezer/markdown）——只用于定位语法区间，文档仍是纯文本
    markdownLanguage.extension,
    // 软换行：预览式编辑的基础体验
    EditorView.lineWrapping,
    // 括号匹配 + 回车自动缩进（列表/代码块续行）
    bracketMatching(),
    indentOnInput(),
    // 撤销 / 重做历史
    history(),
    // 图片相对路径解析基准
    baseDirField,
    // Live Preview 核心（StateField 提供 decorations，块级 Widget 合法）
    livePreviewField,
    // 打字机模式（默认 30% ~ 70% 舒适区）
    typewriter(),
    // 编辑器主题（随 .theme-light/.theme-dark 切换）
    editorTheme(config.theme),
    // 快捷键与编辑命令
    keymap.of([
      { key: "Mod-s", run: () => { config.onSave?.(); return true; } },
      { key: "Mod-o", run: () => { config.onOpenFolder?.(); return true; } },
      ...headingKeymap, // ⌘1~⌘6 标题快捷键
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    // 供 App 跟踪脏状态 / 行列号
    EditorView.updateListener.of((update) => config.onUpdate?.(update)),
  ];
}

/** 创建空文档的编辑器状态 */
export function createEditorState(config: EditorConfig): EditorState {
  return EditorState.create({ doc: "", extensions: buildExtensions(config) });
}

/** 创建并挂载编辑器视图 */
export function createEditorView(
  container: HTMLElement,
  config: EditorConfig,
): EditorView {
  const view = new EditorView({
    state: createEditorState(config),
    parent: container,
  });
  // [调试] 浏览器 demo 下暴露视图实例，便于自动化验证
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
    (window as unknown as { __view?: EditorView }).__view = view;
  }
  return view;
}

/**
 * 打开一个文件：把全文载入编辑器。
 * 关键点：userEvent 设为 "openFile"，使
 *   - 打字机模式不会把它当作用户输入而滚动；
 *   - App 的脏状态跟踪不会把它标记为“未保存修改”。
 * 同时清除本次替换在撤销历史里的记录，避免跨文件撤销。
 */
export function openDocument(
  view: EditorView,
  content: string,
  baseDir: string,
): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: { anchor: 0 },
    effects: setBaseDir.of(baseDir),
    annotations: Transaction.addToHistory.of(false),
    userEvent: "openFile",
  });
  view.focus();
}
