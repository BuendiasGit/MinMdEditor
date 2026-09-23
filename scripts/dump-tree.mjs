// 临时调试脚本：打印 @lezer/markdown 解析出的语法树，用于核对 livePreview 的节点名与区间。
// 用法：node scripts/dump-tree.mjs
import { parser } from "@lezer/markdown";

const md = [
  "# H1 Title",
  "## H2 Title",
  "### H3 Title",
  "**bold** and *italic* and `code`",
  "***bold italic***",
  "- item one",
  "- item two",
  "",
  "1. first",
  "2. second",
  "",
  "> quote text",
  "> second quote line",
  "",
  "[link text](https://example.com)",
  "",
  "![alt text](./img.png)",
  "",
  "```rust",
  'fn main() { println!("hi"); }',
  "```",
  "",
  "plain paragraph",
  "",
  "---",
  "",
  "Setext Heading",
  "==============",
].join("\n");

function walk(node, doc, indent) {
  const label =
    (node.name ? node.name : "(t)") +
    " [" +
    node.from +
    "," +
    node.to +
    "] " +
    JSON.stringify(doc.slice(node.from, node.to).slice(0, 60));
  console.log("  ".repeat(indent) + label);
  for (let c = node.firstChild; c; c = c.nextSibling) walk(c, doc, indent + 1);
}

const tree = parser.parse(md);
console.log("===== syntax tree =====");
walk(tree.topNode, md, 0);
