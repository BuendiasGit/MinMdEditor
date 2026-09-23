// src/editor/theme.ts —— CodeMirror 6 编辑器主题
//
// 整体架构位置：
//   src/editor/ 是 CodeMirror 6 相关代码的集合，theme.ts 负责“编辑器本体”的
//   视觉外观。它只做两件事：
//     1. 用 EditorView.theme() 生成编辑器内部样式（光标、选区、活动行等）；
//     2. 定义代码块 Widget 用的语法高亮 HighlightStyle。
//   颜色一律写 var(--xxx)，CSS 变量定义在 src/theme/theme.css。
//   切换主题时 App 会调用 buildExtensions() 重新装配（StateEffect.reconfigure），
//   传入的 {dark} 标志让 CodeMirror 正确切换内部默认样式。

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { StyleModule } from "style-mod";
import type { ThemeName } from "../theme";

/**
 * 根据主题名生成编辑器主题扩展。
 *
 * 通过 EditorView.theme() 动态生成（用户方案要求）：
 * 所有颜色引用 CSS 变量，所以即使不重新装配，切换 .theme-dark 类也会生效；
 * 重新装配只是为了把 {dark} 标志同步给 CodeMirror 内部。
 */
export function editorTheme(name: ThemeName): Extension {
  return EditorView.theme(
    {
      /* 编辑器整体：占满容器，颜色全部来自全局 CSS 变量 */
      "&": {
        height: "100%",
        backgroundColor: "var(--editor-bg)",
        color: "var(--editor-text)",
        fontSize: "var(--editor-font-size)",
      },
      /* 聚焦时不显示默认的 outline，保持极简 */
      "&.cm-focused": { outline: "none" },
      /* 滚动容器：用 UI 字体与行高（预览文字也用同一行高） */
      ".cm-scroller": {
        fontFamily: "var(--font-ui)",
        lineHeight: "var(--editor-line-height)",
      },
      /* 内容区：内边距 + 光标颜色 */
      ".cm-content": {
        padding: "var(--editor-padding)",
        caretColor: "var(--caret)",
      },
      ".cm-line": { padding: "0" },
      /* 光标所在行底色（打字机模式下也用于标记当前行） */
      ".cm-activeLine": { backgroundColor: "var(--editor-active-line-bg)" },
      /* 光标、选区 */
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--caret)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
        { backgroundColor: "var(--selection-bg)" },
      ".cm-selectionBackground": { backgroundColor: "var(--selection-bg)" },
      "::selection": { backgroundColor: "var(--selection-bg)" },
    },
    { dark: name === "dark" },
  );
}

/**
 * 代码块 Widget 使用的语法高亮样式。
 *
 * 用 HighlightStyle 把 @lezer 解析出的 token 映射成 class，
 * 颜色全部用 var() 引用全局变量（黑白两套主题自动适配）。
 * 该样式在模块加载时挂载一次到 document.head，
 * 代码块 Widget 渲染时用 highlightTree() 产出带这些 class 的 span。
 */
export const codeHighlightStyle: HighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--code-kw)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "var(--code-str)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--code-com)",
    fontStyle: "italic",
  },
  { tag: [t.number, t.bool, t.null], color: "var(--code-num)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--code-fn)",
  },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--code-type)" },
  { tag: [t.operator, t.punctuation], color: "var(--code-op)" },
  { tag: [t.tagName], color: "var(--code-tag)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--code-attr)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--code-var)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--code-meta)" },
]);

/* 把 HighlightStyle 生成的 CSS 挂进页面（只需一次）。
   typeof document 守卫：让模块在非浏览器环境（如 Node 单元测试）也能安全加载。 */
if (typeof document !== "undefined" && codeHighlightStyle.module) {
  StyleModule.mount(document, codeHighlightStyle.module);
}
