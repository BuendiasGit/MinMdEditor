// src/codeLanguages.ts —— 代码块 Widget 支持的语法高亮语言注册表
//
// 整体架构位置：
//   src/ 根部的独立小模块，被 editor/livePreview.ts 引用。
//   它把“语言名 → @codemirror/lang-* 的 Language 实例”的映射集中在一处，
//   代码块 Widget 渲染时根据围栏信息（```rust）查找对应的解析器做高亮。
//
// 设计说明：
//   - 只内置常见语言，保持最小；未知语言回退为纯文本显示；
//   - 每个 Language 实例只创建一次（模块加载时），避免重复解析开销。

import type { Language } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";

// 一次性创建各语言实例
const js = javascript().language;
const ts = javascript({ typescript: true }).language;
const jsx = javascript({ jsx: true }).language;
const tsx = javascript({ jsx: true, typescript: true }).language;
const py = python().language;
const rs = rust().language;
const cssLang = css().language;
const htmlLang = html().language;
const jsonLang = json().language;

/** 围栏语言名（小写）→ Language 实例 */
export const codeLanguages: Record<string, Language> = {
  // JavaScript 系
  js,
  javascript: js,
  jsx,
  ts,
  typescript: ts,
  tsx,
  // Python
  py,
  python: py,
  // Rust
  rs,
  rust: rs,
  // 样式与标记
  css: cssLang,
  html: htmlLang,
  json: jsonLang,
};
