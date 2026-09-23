// src/editor/typewriter.ts —— 打字机模式
//
// 整体架构位置：
//   src/editor/ 是 CodeMirror 6 相关代码的集合，typewriter.ts 实现
//   “光标所在行始终保持在屏幕垂直方向中间位置”。
//
// 实现要点（用户方案）：
//   - 只监听 selectionSet 与 docChanged（不监听其它无关事件）；
//   - 鼠标点击、方向键、回车换行都会触发（分别对应 selectionSet /
//     docChanged 且是用户输入事务；真实键盘经 CM keymap 产生
//     userEvent "select"/"input"，程序化操作如打开文件为
//     userEvent "openFile"，不会触发居中）；
//   - 只在光标越出“舒适视区”（上方 30% ~ 下方 70%）时才滚动，
//     正常输入不打扰；
//   - 布局读取必须延迟到 update 之后：CodeMirror 禁止在插件 update
//     阶段同步读布局（会抛 "Reading the editor layout isn't allowed
//     during an update"）。因此 select 与 input 两类事件统一用
//     requestAnimationFrame 包一层（回车换行等 DOM 变化后同样生效）；
//   - 滚动使用 CodeMirror 6 官方 API view.scrollIntoView(pos, { y: "center" })。
//
// 边界情况：光标落在块级 Widget（代码块 / 图片 / 分隔线）的替换区间内时，
// coordsAtPos 返回 null（该区间没有普通文本布局）。此时退回用
// lineBlockAt 拿块（BlockInfo）坐标做同样的越界判断，保证居中不失效。
//
// 本文件用配置参数（topRatio / bottomRatio）划定舒适区，默认按用户方案。

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export interface TypewriterOptions {
  /** 舒适区上边界（相对视口高度），默认 0.3 */
  topRatio?: number;
  /** 舒适区下边界（相对视口高度），默认 0.7 */
  bottomRatio?: number;
}

/**
 * 生成打字机模式扩展。
 * 通过 options 可以微调舒适区；默认 30% / 70%（用户方案）。
 */
export function typewriter(options: TypewriterOptions = {}): Extension {
  const topRatio = options.topRatio ?? 0.3;
  const bottomRatio = options.bottomRatio ?? 0.7;

  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        // 只关心“用户主动产生”的改动/选择变化：
        //   - 鼠标点击 / 方向键 → userEvent "select"
        //   - 打字 / 删除 / 撤销 / 重做 → userEvent "input"/"delete"/"undo"/"redo"
        // 打开文件等程序化操作（userEvent "openFile"）不触发居中，
        // 避免应用启动或换文件时页面突然跳动。
        const userSelect = update.transactions.some((tr) =>
          tr.isUserEvent("select"),
        );
        const userInput = update.transactions.some(
          (tr) =>
            tr.isUserEvent("input") ||
            tr.isUserEvent("delete") ||
            tr.isUserEvent("undo") ||
            tr.isUserEvent("redo"),
        );
        if (!userSelect && !userInput) return;

        // 统一延迟到下一帧再读布局并滚动：
        //   - CM 禁止在 update 阶段读布局（coordsAtPos / lineBlockAt 会抛错）；
        //   - 内容变化（回车换行）后 DOM 布局在下一帧才就绪。
        // 连续输入时多个 rAF 回调会按顺序执行，最后一次拿到最新选区；
        // 滚动事务本身不带 userEvent，不会触发本插件的死循环。
        requestAnimationFrame(() =>
          centerIfNeeded(update.view, topRatio, bottomRatio),
        );
      }
    },
  );
}

/**
 * 取光标所在位置在滚动容器内的上下边界（视口相对坐标）。
 * 优先 coordsAtPos；在块级 Widget 替换区间内返回 null 时，
 * 用 lineBlockAt 的块坐标（文档相对 → 换算成视口相对）。
 */
function cursorBounds(
  view: EditorView,
  head: number,
): { top: number; bottom: number } | null {
  const coords = view.coordsAtPos(head);
  if (coords) return { top: coords.top, bottom: coords.bottom };

  // 光标在块级 Widget（代码块/图片/分隔线）内：
  // 块的 top/bottom 是相对文档内容，换算成相对滚动容器视口
  const block = view.lineBlockAt(head);
  const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
  const scrolled = view.scrollDOM.scrollTop;
  return {
    top: scrollerTop + block.top - scrolled,
    bottom: scrollerTop + block.bottom - scrolled,
  };
}

/**
 * 判断光标是否越出舒适视区；越界时把光标行滚动到垂直居中。
 */
function centerIfNeeded(
  view: EditorView,
  topRatio: number,
  bottomRatio: number,
): void {
  const head = view.state.selection.main.head;
  const bounds = cursorBounds(view, head);
  if (!bounds) return; // 布局尚未就绪（如组合输入中）

  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const relTop = bounds.top - scrollRect.top;
  const relBottom = bounds.bottom - scrollRect.top;
  const height = scrollRect.height;

  // 舒适视区：上方 topRatio、下方 bottomRatio 之间；
  // 光标落在这个区间内时不做任何滚动，越界才居中。
  if (relTop < height * topRatio || relBottom > height * bottomRatio) {
    // EditorView.scrollIntoView 返回一个“滚动效果”，需要随事务 dispatch；
    // 该事务不产生任何改动/选区变化，不会触发本插件的死循环。
    view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
  }
}
