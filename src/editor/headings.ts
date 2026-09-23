// src/editor/headings.ts —— 标题快捷键（⌘1 ~ ⌘6）
//
// 整体架构位置：
//   src/editor/ 是 CodeMirror 6 相关代码的集合，headings.ts 提供
//   “把当前行/选区行转为 1~6 级 ATX 标题”的快捷键。
//   在 setup.ts 的 buildExtensions() 里随 keymap 一起装配。
//
// 行为（对标主流 Markdown 编辑器）：
//   - ⌘1~⌘6：把光标所在行（或选区覆盖的所有行）设置为对应级别标题，
//     即在行首写入 N 个 # 加一个空格；
//   - 如果该行已经是同级别标题 → 再次按下还原为普通段落（去掉 #）；
//   - 如果已是其它级别标题 → 替换为新的级别；
//   - 保留原文内容和行位置，光标映射到新标题文字之后。
//
// 实现要点：
//   - 用 state.changes() 一次性生成 ChangeSet（不逐行 dispatch），
//   - 通过 ChangeSet.map 把选区映射到新文档，位置不丢。

import type { KeyBinding } from "@codemirror/view";
import type { EditorState, Transaction } from "@codemirror/state";

/** 匹配行首的 ATX 标题标记：#~###### 后跟一个空格或行尾 */
const HEADING_PREFIX_RE = /^(#{1,6})( |$)/;

/**
 * 把选区涉及的所有行设为指定级别标题，返回一次 dispatch 用的 Transaction。
 * 同一行已为该级别 → 去掉标记还原为段落（可反复切换）。
 * 导出以便单元测试（不需要 EditorView）。
 */
export function applyHeading(state: EditorState, level: number): Transaction {
  const changes: { from: number; to?: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = state.doc.line(n);
      const m = line.text.match(HEADING_PREFIX_RE);
      if (m && m[1].length === level) {
        // 已是同级别 → 删除 "#… " 前缀（还原为段落）
        const removeLen = m[1].length + (m[2] === " " ? 1 : 0);
        changes.push({ from: line.from, to: line.from + removeLen, insert: "" });
      } else if (m) {
        // 其它级别 → 替换前缀
        const removeLen = m[1].length + (m[2] === " " ? 1 : 0);
        changes.push({
          from: line.from,
          to: line.from + removeLen,
          insert: "#".repeat(level) + " ",
        });
      } else {
        // 普通行 → 加前缀
        changes.push({ from: line.from, insert: "#".repeat(level) + " " });
      }
    }
  }

  const changeSet = state.changes(changes);
  return state.update({
    changes: changeSet,
    // 选区映射到新文档：光标落在新插入的 "# " 之后
    selection: state.selection.map(changeSet),
    userEvent: "input", // 视为用户输入 → 标记脏状态、触发打字机居中
  });
}

/** ⌘1~⌘6 标题快捷键绑定列表（供 setup.ts 合并进 keymap） */
export const headingKeymap: KeyBinding[] = (
  Array.from({ length: 6 }, (_, i) => ({
    key: `Mod-${i + 1}`,
    run: (view) => {
      view.dispatch(applyHeading(view.state, i + 1));
      return true;
    },
  })) as KeyBinding[]
);
