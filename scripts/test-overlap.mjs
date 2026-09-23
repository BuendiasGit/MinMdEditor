// 临时脚本：验证 replace 装饰嵌套在 mark 装饰内是否被接受
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration } from "@codemirror/view";

const b = new RangeSetBuilder();
const hide = Decoration.replace({});
const markA = Decoration.mark({ class: "a" });
b.add(0, 10, markA); // 整个标题区间
b.add(0, 2, hide); // HeaderMark "# " 被替换，位于 markA 内部
b.add(3, 5, hide); // 另一个替换也在 markA 内部
try {
  const set = b.finish();
  console.log("OK, ranges:", set.size);
} catch (e) {
  console.log("ERROR:", e.message);
}
