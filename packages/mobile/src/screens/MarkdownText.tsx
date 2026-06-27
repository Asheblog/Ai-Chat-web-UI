import { Platform, StyleSheet, Text, View } from "react-native";

import type { AppTheme } from "../theme";
import { spacing } from "../theme";

type MarkdownTextProps = {
  content: string;
  isUser: boolean;
  theme: AppTheme;
};

export function MarkdownText({ content, isUser, theme }: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(content);
  const baseColor = isUser ? "#FFFFFF" : theme.foreground;
  const mutedColor = isUser ? "#DBEAFE" : theme.mutedForeground;

  return (
    <View style={styles.markdownRoot}>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <Text
              key={`code-${index}`}
              selectable
              style={[
                styles.codeBlock,
                {
                  backgroundColor: isUser ? "rgba(15, 23, 42, 0.22)" : theme.inputBackground,
                  borderColor: isUser ? "rgba(255, 255, 255, 0.22)" : theme.border,
                  color: baseColor,
                },
              ]}
            >
              {block.text}
            </Text>
          );
        }

        return (
          <Text
            key={`line-${index}`}
            selectable
            style={[
              styles.messageText,
              block.kind === "heading" && styles.headingText,
              block.kind === "quote" && { color: mutedColor },
              { color: baseColor },
            ]}
          >
            {block.prefix ? <Text style={{ color: mutedColor }}>{block.prefix}</Text> : null}
            {renderInlineMarkdown(block.text, isUser, theme)}
          </Text>
        );
      })}
    </View>
  );
}

type MarkdownBlock =
  | { type: "code"; text: string }
  | { type: "text"; text: string; kind?: "heading" | "quote"; prefix?: string };

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  for (const rawLine of lines) {
    if (rawLine.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: codeLines.join("\n") || " " });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    const line = rawLine.trimEnd();
    if (!line.trim()) {
      blocks.push({ type: "text", text: " " });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "text", kind: "heading", text: heading[2] });
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ type: "text", prefix: "• ", text: bullet[1] });
      continue;
    }

    const ordered = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ordered) {
      blocks.push({ type: "text", prefix: `${ordered[1]}. `, text: ordered[2] });
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(line);
    if (quote) {
      blocks.push({ type: "text", kind: "quote", prefix: "│ ", text: quote[1] });
      continue;
    }

    blocks.push({ type: "text", text: line });
  }

  if (inCode) {
    blocks.push({ type: "code", text: codeLines.join("\n") || " " });
  }

  return blocks;
}

function renderInlineMarkdown(content: string, isUser: boolean, theme: AppTheme) {
  const parts = content.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text
          key={`${part}-${index}`}
          style={[
            styles.inlineCode,
            {
              backgroundColor: isUser ? "rgba(15, 23, 42, 0.22)" : theme.inputBackground,
              color: isUser ? "#FFFFFF" : theme.foreground,
            },
          ]}
        >
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={`${part}-${index}`} style={styles.boldText}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return part;
  });
}

const styles = StyleSheet.create({
  markdownRoot: {
    rowGap: 6,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24,
  },
  headingText: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 25,
  },
  boldText: {
    fontWeight: "800",
  },
  inlineCode: {
    borderRadius: 4,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 4,
  },
  codeBlock: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 14,
    lineHeight: 21,
    padding: spacing.md,
  },
});
