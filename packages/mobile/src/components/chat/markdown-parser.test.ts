import { describe, expect, it } from "vitest";

import { parseInlineSpans, parseMarkdownBlocks } from "./markdown-parser";

describe("移动端 Rich Markdown 解析器", () => {
  it("解析标题、代码块、表格、引用与列表", () => {
    const sample = [
      "# 主标题",
      "",
      "> 引用第一行",
      "> 引用第二行",
      "",
      "- 列表项 A **加粗**",
      "- 列表项 B `inline`",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| 列1 | 列2 |",
      "| --- | --- |",
      "| 值1 | 值2 |",
    ].join("\n");

    const blocks = parseMarkdownBlocks(sample);

    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "blockquote",
      "list",
      "code",
      "table",
    ]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[3]).toEqual({
      type: "code",
      language: "ts",
      code: "const x = 1;",
    });
    expect(blocks[4]).toEqual({
      type: "table",
      headers: ["列1", "列2"],
      rows: [["值1", "值2"]],
    });
  });

  it("保留可复制代码里的 LaTeX 分隔符，只在正文中识别公式", () => {
    const inline = String.raw`\(a + b\)`;
    const display = String.raw`\[c = d\]`;
    const code = [inline, display].join("\n");
    const prose = "代码：`" + inline + "`；公式：" + inline;
    const blocks = parseMarkdownBlocks(["```sh", code, "```", prose, display].join("\n"));

    expect(blocks).toEqual([
      { type: "code", language: "sh", code },
      { type: "paragraph", spans: [
        { type: "text", text: "代码：" },
        { type: "code", text: inline },
        { type: "text", text: "；公式：" },
        { type: "math", text: "a + b" },
      ] },
      { type: "math", latex: "c = d" },
    ]);
  });

  it("解析行内及块级 LaTeX 公式和外链", () => {
    const blocks = parseMarkdownBlocks("$$\nE = mc^2\n$$");
    expect(blocks).toEqual([{ type: "math", latex: "E = mc^2" }]);

    const spans = parseInlineSpans("请看 $a^2 + b^2 = c^2$ 以及 [官网](https://example.com)");
    expect(spans).toContainEqual({ type: "math", text: "a^2 + b^2 = c^2" });
    expect(spans).toContainEqual({
      type: "link",
      text: "官网",
      url: "https://example.com",
    });
  });
});
