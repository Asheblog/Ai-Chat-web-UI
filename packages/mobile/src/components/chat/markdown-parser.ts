function normalizeLatexDelimiters(input: string): string {
  return input
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `$$\n${String(body).trim()}\n$$`)
    .replace(/\\\((.+?)\\\)/g, (_, body) => `$${String(body).trim()}$`);
}

export type InlineSpan =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "math"; text: string }
  | { type: "link"; text: string; url: string };

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; spans: InlineSpan[] }
  | { type: "paragraph"; spans: InlineSpan[] }
  | { type: "list"; ordered: boolean; items: InlineSpan[][] }
  | { type: "blockquote"; lines: InlineSpan[][] }
  | { type: "code"; language: string; code: string }
  | { type: "math"; latex: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "divider" };

const TOKEN_PATTERN =
  /(`[^`\n]+`|\$\$?[^$\n]+\$?\$|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

export function parseInlineSpans(line: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let cursor = 0;

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > cursor) {
      spans.push({ type: "text", text: line.slice(cursor, start) });
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      spans.push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("$$") && token.endsWith("$$") && token.length > 4) {
      spans.push({ type: "math", text: token.slice(2, -2).trim() });
    } else if (token.startsWith("$") && token.endsWith("$") && token.length > 2) {
      spans.push({ type: "math", text: token.slice(1, -1).trim() });
    } else if (token.startsWith("**") && token.endsWith("**")) {
      spans.push({ type: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("*") && token.endsWith("*")) {
      spans.push({ type: "italic", text: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (linkMatch) {
        spans.push({ type: "link", text: linkMatch[1], url: linkMatch[2] });
      } else {
        spans.push({ type: "text", text: token });
      }
    } else {
      spans.push({ type: "text", text: token });
    }

    cursor = start + token.length;
  }

  if (cursor < line.length) {
    spans.push({ type: "text", text: line.slice(cursor) });
  }

  return spans.length > 0 ? spans : [{ type: "text", text: line }];
}

function splitTableRow(rowLine: string): string[] {
  const trimmed = rowLine.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseMarkdownBlocks(rawText: string): MarkdownBlock[] {
  const normalized = normalizeLatexDelimiters(rawText).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    // Display LaTeX math block $$...$$
    if (trimmed.startsWith("$$")) {
      if (trimmed.length > 4 && trimmed.endsWith("$$")) {
        blocks.push({ type: "math", latex: trimmed.slice(2, -2).trim() });
        index += 1;
        continue;
      }
      const mathLines: string[] = [trimmed.slice(2)];
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("$$")) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        const last = lines[index].trim();
        mathLines.push(last.slice(0, -2));
        index += 1;
      }
      blocks.push({ type: "math", latex: mathLines.join("\n").trim() });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", level, spans: parseInlineSpans(headingMatch[2]) });
      index += 1;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes("|") &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = splitTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: InlineSpan[][] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        const content = lines[index].trim().replace(/^>\s?/, "");
        quoteLines.push(parseInlineSpans(content));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    // Unordered / Ordered list
    const isBullet = /^[-*•]\s+/.test(trimmed);
    const isOrdered = /^\d+[.)]\s+/.test(trimmed);
    if (isBullet || isOrdered) {
      const ordered = isOrdered;
      const items: InlineSpan[][] = [];
      while (index < lines.length) {
        const cur = lines[index].trim();
        const match = ordered ? /^\d+[.)]\s+(.+)$/.exec(cur) : /^[-*•]\s+(.+)$/.exec(cur);
        if (!match) break;
        items.push(parseInlineSpans(match[1]));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph (collect consecutive non-special lines)
    const paraLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const nextTrim = lines[index].trim();
      if (
        !nextTrim ||
        nextTrim.startsWith("```") ||
        nextTrim.startsWith("$$") ||
        nextTrim.startsWith(">") ||
        /^(#{1,4})\s+/.test(nextTrim) ||
        /^[-*•]\s+/.test(nextTrim) ||
        /^\d+[.)]\s+/.test(nextTrim) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(nextTrim)
      ) {
        break;
      }
      paraLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", spans: parseInlineSpans(paraLines.join("\n")) });
  }

  return blocks;
}
