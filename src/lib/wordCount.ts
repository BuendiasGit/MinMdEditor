// src/lib/wordCount.ts —— 文档字数统计
//
// 整体架构位置：
//   src/lib/ 放纯逻辑/轻量封装。本模块只做“从文本算出三类字数”，
//   无副作用，便于单元测试；由 App.tsx 在 docChanged 时调用，
//   结果展示在状态栏。
//
// 统计口径（与主流写作工具一致）：
//   - 总字数：非空白字符总数（含标点）；
//   - 中文字数：CJK 统一表意文字（汉字）字符数；
//   - 英文字数：英文单词数（连续 [A-Za-z] 视为一个词）。

export interface WordCount {
  /** 总字数（非空白字符数） */
  total: number;
  /** 中文字数（汉字字符数） */
  chinese: number;
  /** 英文字数（英文单词数） */
  english: number;
}

/** 对一段 Markdown 文本统计三类字数 */
export function countWords(text: string): WordCount {
  const total = text.replace(/\s/g, "").length;
  const chinese = (text.match(/[\u4E00-\u9FFF]/g) ?? []).length;
  const english = (text.match(/[A-Za-z]+/g) ?? []).length;
  return { total, chinese, english };
}
