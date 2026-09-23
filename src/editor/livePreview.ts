// src/editor/livePreview.ts —— Live Preview（实时预览）核心
//
// 整体架构位置：
//   src/editor/ 是 CodeMirror 6 相关代码的集合，livePreview.ts 实现
//   “始终渲染为格式化文本”的全部 Decoration 逻辑（用户 2026-09-23 调整：
//   去掉“光标行显示源码”，编辑器全程保持渲染态，标记永不露出）。
//
// 实现原则（用户方案）：
//   - 文档在内存中始终是纯 Markdown 字符串，不转成结构化节点；
//   - 完全使用 CodeMirror 6 官方 Decoration 系统（mark / replace / Widget），
//     不用 HTML 段落渲染方案（不用 Tiptap / ProseMirror）；
//   - 语法树来自 @codemirror/lang-markdown 内置的 @lezer/markdown 解析器，
//     只用于“定位语法标记和构造的区间”，绝不作为文档数据源。
//
// 工作方式：
//   1. ViewPlugin 监听 docChanged，重建 DecorationSet（装饰与光标位置无关）；
//   2. 解析器把所有语法标记（#、**、*、`、[]()、>、- 等）解析为
//      名字以 Mark 结尾的节点（HeaderMark、EmphasisMark、CodeMark…），
//      一律用 replace 把它们“隐藏”（文字仍在文档里，只是不渲染）；
//   3. 构造区间（标题/加粗/斜体/行内代码/链接/引用）用 mark 加样式类；
//   4. 图片、代码块、分隔线用 Widget 替换成真实渲染。

import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { syntaxTree, type Language } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import type { SyntaxNode } from "@lezer/common";
import { convertFileSrc } from "@tauri-apps/api/core";
import { codeHighlightStyle } from "./theme";
import { codeLanguages } from "../codeLanguages";

// ---------------------------------------------------------------------------
// 图片资源目录（baseDir）
// ---------------------------------------------------------------------------
// Markdown 里的相对图片路径需要相对“当前打开文件所在目录”解析。
// 用一个 StateField 存 baseDir，App 打开文件时通过 setBaseDir effect 更新。
// 打开文件必然伴随 doc 变化 → 装饰重建时读到最新值。

export const setBaseDir = StateEffect.define<string>();

export const baseDirField = StateField.define<string>({
  create: () => "",
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBaseDir)) return e.value;
    return value;
  },
});

/**
 * 把 Markdown 里的图片 src 解析成 webview 可加载的 URL：
 *   - http(s) / data: 直接使用；
 *   - 绝对路径或相对路径 → 先规整为本地绝对路径，再用 Tauri 官方
 *     convertFileSrc 转成 asset:// 协议 URL（需要在 tauri.conf.json
 *     开启 assetProtocol）。
 */
function resolveImageSrc(src: string, baseDir: string): string {
  const s = src.trim();
  if (/^(https?:|data:)/i.test(s)) return s;
  // 非 Tauri 环境（浏览器调试 ?demo=1）：没有 convertFileSrc，直接返回原路径
  const tauriInternals = (
    window as unknown as { __TAURI_INTERNALS__?: unknown }
  ).__TAURI_INTERNALS__;
  if (!tauriInternals) return s;
  let abs: string;
  if (s.startsWith("/")) {
    abs = s;
  } else {
    try {
      // 用 URL 构造器做路径拼接与 .. 归一化
      abs = decodeURIComponent(
        new URL(s, "file://" + baseDir.replace(/\/?$/, "/")).pathname,
      );
    } catch {
      abs = baseDir + "/" + s;
    }
  }
  return convertFileSrc(abs);
}

// ---------------------------------------------------------------------------
// 预生成的 Decoration 对象（可复用，避免每次重建）
// ---------------------------------------------------------------------------
/** 隐藏语法标记：replace 不带 widget = 该区间文字不渲染，但仍在文档里 */
const hideMark = Decoration.replace({});
const strongMark = Decoration.mark({ class: "cm-lp-strong" });
const emMark = Decoration.mark({ class: "cm-lp-em" });
const codeMark = Decoration.mark({ class: "cm-lp-code" });
const linkMark = Decoration.mark({ class: "cm-lp-link" });
const quoteMark = Decoration.mark({ class: "cm-lp-quote" });

// ---------------------------------------------------------------------------
// Widgets（遵循 WidgetType 官方签名：
//   eq 接收 WidgetType 参数；estimatedHeight 是 getter 而非方法）
// ---------------------------------------------------------------------------

/**
 * 图片 Widget：把 ![alt](src) 替换成真实 <img>。
 * 点击仍交给编辑器处理（光标落到图片位置即可继续编辑）。
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.alt === this.alt
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image-wrap";
    const img = document.createElement("img");
    img.className = "cm-lp-image";
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    // 图片加载后高度可能变化，让编辑器重新测量布局
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => {
      // 加载失败：降级为替代文本，避免显示破图
      wrap.classList.add("cm-lp-image-error");
      wrap.textContent = this.alt || "(图片加载失败)";
    });
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false; // 点击仍由编辑器处理（放置光标），保持可编辑
  }
}

/**
 * 代码块 Widget：把整段 ```lang ... ``` 替换为带语法高亮的渲染块。
 * 只有围栏在行首时才做块级替换（块级 Widget 要求覆盖整行）。
 */
class CodeBlockWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CodeBlockWidget &&
      other.code === this.code &&
      other.lang === this.lang
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-codeblock";
    const lang = this.lang.trim().toLowerCase();
    if (lang) {
      const header = document.createElement("div");
      header.className = "cm-lp-codeblock-lang";
      header.textContent = lang;
      wrap.appendChild(header);
    }
    const pre = document.createElement("pre");
    pre.className = "cm-lp-codeblock-pre";
    const language = codeLanguages[lang];
    if (language) {
      highlightCodeInto(pre, language, this.code);
    } else {
      pre.textContent = this.code;
    }
    wrap.appendChild(pre);
    return wrap;
  }

  /** 粗略高度，供编辑器滚动锚定；渲染后会自动精确测量 */
  get estimatedHeight(): number {
    const lines = this.code.split("\n").length;
    return 26 + lines * 19 + (this.lang ? 24 : 0);
  }
}

/**
 * 列表符号 Widget：无序列表显示圆点，有序列表显示数字 + 点号。
 */
class ListMarkerWidget extends WidgetType {
  constructor(
    readonly ordered: boolean,
    readonly mark: string,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ListMarkerWidget &&
      other.ordered === this.ordered &&
      other.mark === this.mark
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.ordered ? "cm-lp-list-ol" : "cm-lp-list-ul";
    if (this.ordered) {
      const n = parseInt(this.mark, 10);
      span.textContent = (Number.isNaN(n) ? "1" : String(n)) + ".";
    } else {
      span.textContent = "•";
    }
    return span;
  }
}

/** 分隔线 Widget：--- 渲染为一条横线 */
class HorizontalRuleWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof HorizontalRuleWidget;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-lp-hr";
    return div;
  }

  get estimatedHeight(): number {
    return 18;
  }
}

/** 复用单例（分隔线无状态） */
const hrWidget = new HorizontalRuleWidget();

// ---------------------------------------------------------------------------
// 代码高亮渲染（官方 API：Language.parser.parse + @lezer/highlight highlightTree）
// ---------------------------------------------------------------------------
function highlightCodeInto(pre: HTMLElement, language: Language, code: string) {
  const tree = language.parser.parse(code);
  let pos = 0;
  const push = (text: string, cls?: string) => {
    if (!text) return;
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    pre.appendChild(span);
  };
  // 回调给出每个高亮区间；中间的间隙（空白等）原样补上
  highlightTree(tree, codeHighlightStyle, (from, to, classes) => {
    push(code.slice(pos, from));
    push(code.slice(from, to), classes);
    pos = to;
  });
  push(code.slice(pos));
}

// ---------------------------------------------------------------------------
// 装饰构建
// ---------------------------------------------------------------------------

/** 从 Image 节点提取 src 与 alt，构造图片 Widget */
function imageWidgetFor(
  node: SyntaxNode,
  doc: { sliceString(a: number, b: number): string },
  baseDir: string,
): ImageWidget {
  const urlNode = node.getChild("URL");
  const src = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : "";
  let alt = "";
  if (urlNode) {
    alt = doc
      .sliceString(node.from, urlNode.from)
      .replace(/^!?\[/, "")
      .replace(/[\]()]$/, "");
  } else {
    alt = doc.sliceString(node.from, node.to);
  }
  return new ImageWidget(resolveImageSrc(src, baseDir), alt);
}

/**
 * 根据当前文档与光标位置构建整棵装饰树。
 *
 * 遍历 @lezer/markdown 语法树（访问顺序即文档顺序，天然满足
 * RangeSetBuilder 的“按 from 递增添加”约束；同一 from 处父节点的
 * mark 先加入、子节点的 replace 后加入，startSide 排序也正确）。
 *
 * 规则：
 *   - 与光标所在行（或选区覆盖的行）相交的节点 → 不做任何装饰（显示源码）；
 *   - 名字以 Mark 结尾的节点 → replace 隐藏；
 *   - URL 节点（链接地址）→ replace 隐藏；
 *   - 标题/加粗/斜体/行内代码/链接/引用 → mark 加样式类（可嵌套叠加）；
 *   - 图片/代码块/分隔线/列表符号 → Widget 替换。
 */
/**
 * 基于 EditorState 构建装饰（与视图无关，便于单元测试）。
 * 真实路径：livePreviewField 的 create/update → decorationsForState(state)。
 */
export function decorationsForState(state: EditorState): DecorationSet {
  const doc = state.doc;
  const baseDir = state.field(baseDirField);

  const builder = new RangeSetBuilder<Decoration>();
  // 装饰先收集到数组，最后统一排序再写入 builder：
  // RangeSetBuilder 要求按 (from, startSide) 递增添加，而 mark 的
  // startSide 是 500000000、replace 是 499999999——同一 from 处
  // replace 必须先于 mark 加入。先收集后排序可以彻底规避顺序问题。
  const jobs: { from: number; to: number; deco: Decoration }[] = [];
  const add = (from: number, to: number, deco: Decoration) =>
    jobs.push({ from, to, deco });

  const visit = (node: SyntaxNode): void => {
    const name = node.name;
    if (!name) return;

    // ---- 整段替换为 Widget 的节点（命中后不再递归） ----
    if (name === "Image") {
      add(
        node.from,
        node.to,
        Decoration.replace({ widget: imageWidgetFor(node, doc, baseDir) }),
      );
      return;
    }
    if (name === "FencedCode") {
      const line = doc.lineAt(node.from);
      if (line.from === node.from) {
        // 围栏在行首 → 块级替换为代码 Widget
        const info = node.getChild("CodeInfo");
        const text = node.getChild("CodeText");
        const lang = info ? doc.sliceString(info.from, info.to) : "";
        const code = text ? doc.sliceString(text.from, text.to) : "";
        const endPos = Math.min(node.to, doc.length);
        const endLine = doc.lineAt(Math.max(endPos - 1, 0));
        add(
          line.from,
          endLine.to,
          Decoration.replace({
            widget: new CodeBlockWidget(code, lang),
            block: true,
          }),
        );
        return;
      }
      // 缩进围栏等非整行场景：不整块替换，继续走通用分支（只隐藏围栏标记）
    }
    if (name === "HorizontalRule") {
      const line = doc.lineAt(node.from);
      if (line.from === node.from) {
        add(
          line.from,
          line.to,
          Decoration.replace({ widget: hrWidget, block: true }),
        );
      }
      return;
    }

    // ---- 通用语法标记：名字以 Mark 结尾 = 要隐藏的符号 ----
    if (name.endsWith("Mark")) {
      // 列表符号由 ListItem 分支统一替换成圆点/数字 Widget，这里跳过
      if (name === "ListMark" && node.parent?.name === "ListItem") return;
      add(node.from, node.to, hideMark);
      return;
    }
    // 链接/图片中的 URL 地址部分也属于要隐藏的语法
    if (name === "URL") {
      add(node.from, node.to, hideMark);
      return;
    }

    // ---- 构造区间样式（mark 区间允许重叠，嵌套加粗斜体可叠加） ----
    if (name.startsWith("ATXHeading")) {
      const level = parseInt(name.slice("ATXHeading".length), 10);
      add(node.from, node.to, Decoration.mark({ class: `cm-lp-h${level}` }));
    } else if (name === "SetextHeading1") {
      add(node.from, node.to, Decoration.mark({ class: "cm-lp-h1" }));
    } else if (name === "SetextHeading2") {
      add(node.from, node.to, Decoration.mark({ class: "cm-lp-h2" }));
    } else if (name === "StrongEmphasis") {
      add(node.from, node.to, strongMark);
    } else if (name === "Emphasis") {
      add(node.from, node.to, emMark);
    } else if (name === "InlineCode") {
      add(node.from, node.to, codeMark);
    } else if (name === "Link") {
      add(node.from, node.to, linkMark);
    } else if (name === "Blockquote") {
      add(node.from, node.to, quoteMark);
    } else if (name === "ListItem") {
      const listMark = node.getChild("ListMark");
      if (listMark) {
        const ordered = node.parent?.name === "OrderedList";
        const markText = doc.sliceString(listMark.from, listMark.to);
        add(
          listMark.from,
          listMark.to,
          Decoration.replace({
            widget: new ListMarkerWidget(ordered, markText),
          }),
        );
      }
    }

    // ---- 递归子节点（子节点的 replace 在父节点 mark 之后加入，排序正确） ----
    for (let c = node.firstChild; c; c = c.nextSibling) visit(c);
  };

  visit(syntaxTree(state).topNode);

  // 排序后写入：确保 (from, startSide) 严格递增
  jobs.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  for (const j of jobs) builder.add(j.from, j.to, j.deco);

  return builder.finish();
}

// ---------------------------------------------------------------------------
// StateField：Live Preview 本体
// ---------------------------------------------------------------------------
// 官方约束：块级 Widget（代码块、分隔线）只能通过 StateField 提供的
// decorations 生效；若来自 ViewPlugin 会抛
// "Block decorations may not be specified via plugins"（已验证）。
// 因此用 StateField + provide(EditorView.decorations) 承载装饰：
//   - create：状态创建时按当前文档构建一次；
//   - update：仅 docChanged 时重建（装饰与光标位置无关）。
export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return decorationsForState(state);
  },
  update(value, tr) {
    if (tr.docChanged) return decorationsForState(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 兼容导出名（装配时使用 livePreviewField） */
export const livePreview: Extension = livePreviewField;
