// scripts/test-live-preview.ts —— 确定性验证 livePreview 装饰生成逻辑
// 用法：npx tsx scripts/test-live-preview.ts
// 测试环境无 Tauri WebView，给 convertFileSrc 打一个 stub（仅图片解析路径用到）
(globalThis as Record<string, unknown>).window = {
  __TAURI_INTERNALS__: {
    convertFileSrc: (p: string, _protocol?: string) => "asset://local/" + p,
  },
};
import { EditorState } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { decorationsForState, baseDirField } from "../src/editor/livePreview";
import { applyHeading } from "../src/editor/headings";

const md = `# Title
> quote line
**bold** and *italic* and \`code\`
- item one
1. first

\`\`\`rust
fn main() {}
\`\`\`

![alt](img.png)
`;

// 光标放在第一行（与打开文件后的初始状态一致）
const state = EditorState.create({
  doc: md,
  selection: { anchor: 0 },
  extensions: [markdownLanguage.extension, baseDirField],
});

// 1) 语法树结构确认
console.log("== tree ==");
const tree = syntaxTree(state);
for (let c = tree.topNode.firstChild; c; c = c.nextSibling) {
  console.log(`  ${c.name} [${c.from},${c.to}]`);
}

// 2) 装饰集合确认（2026-09-23 调整：装饰与光标位置无关，全程渲染）
console.log("== decorations ==");
const set = decorationsForState(state);
let count = 0;
const hits: string[] = [];
set.between(0, state.doc.length, (from, to, deco) => {
  const spec = deco.spec as { class?: string; widget?: unknown };
  const kind = spec.class ? `mark:${spec.class}` : spec.widget ? "widget" : "replace:hide";
  console.log(`  [${from},${to}] ${kind}  "${md.slice(from, to).replace(/\n/g, "\\n")}"`);
  hits.push(kind);
  count++;
});
console.log("total decorations:", count);

// 断言：光标行（第 1 行）也必须渲染——隐藏 # 并给标题加样式
if (!hits.includes("replace:hide") || !hits.some((k) => k.startsWith("mark:cm-lp-h"))) {
  throw new Error("FAIL: 标题标记未被隐藏/标题样式未应用");
}
console.log("OK: 光标行同样被渲染（标题标记隐藏 + 标题样式 mark）");

// 3) ⌘1~⌘6 标题快捷键逻辑（纯 State 验证）
console.log("== heading shortcut ==");
const h1 = EditorState.create({ doc: "plain line\n", selection: { anchor: 0 } });
const after = h1.update(applyHeading(h1, 1)).state;
console.log(`  after Mod-1: "${after.doc.toString().trim()}"`);
if (!after.doc.toString().startsWith("# plain line")) throw new Error("FAIL: Mod-1 未加标题");
const after3 = after.update(applyHeading(after, 3)).state;
console.log(`  after Mod-3: "${after3.doc.toString().trim()}"`);
if (!after3.doc.toString().startsWith("### plain line")) throw new Error("FAIL: Mod-3 未替换级别");
const after0 = after3.update(applyHeading(after3, 3)).state;
console.log(`  Mod-3 again: "${after0.doc.toString().trim()}"`);
if (after0.doc.toString() !== "plain line\n") throw new Error("FAIL: 同级别未还原段落");

// 3b) 菜单「编辑 → 正文」（heading-0）：还原任何级别为段落
const h2 = EditorState.create({ doc: "## headed line\n", selection: { anchor: 0 } });
const afterBody = h2.update(applyHeading(h2, 0)).state;
console.log(`  heading-0: "${afterBody.doc.toString().trim()}"`);
if (afterBody.doc.toString() !== "headed line\n") throw new Error("FAIL: heading-0 未还原为正文");
console.log("OK: 标题快捷键加/换/还原/正文全部正确");
