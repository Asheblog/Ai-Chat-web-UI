import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { lightTap, successTap } from "../../native/haptics";
import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";
import { parseMarkdownBlocks, type InlineSpan, type MarkdownBlock } from "./markdown-parser";

type RichMarkdownProps = {
  text: string;
  theme: AppTheme;
  isUser?: boolean;
};

export function RichMarkdown({ text, theme, isUser = false }: RichMarkdownProps) {
  const blocks = parseMarkdownBlocks(text);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <MarkdownBlockView
          key={`${block.type}-${index}`}
          block={block}
          isUser={isUser}
          theme={theme}
        />
      ))}
    </View>
  );
}

function MarkdownBlockView({
  block,
  theme,
  isUser,
}: {
  block: MarkdownBlock;
  theme: AppTheme;
  isUser: boolean;
}) {
  if (block.type === "divider") {
    return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
  }

  if (block.type === "heading") {
    const sizeMap = { 1: 20, 2: 18, 3: 16, 4: 15 } as const;
    return (
      <Text
        selectable
        style={[
          styles.heading,
          { color: theme.foreground, fontSize: sizeMap[block.level], lineHeight: sizeMap[block.level] + 7 },
        ]}
      >
        {renderSpans(block.spans, theme)}
      </Text>
    );
  }

  if (block.type === "blockquote") {
    return (
      <View
        style={[
          styles.blockquote,
          {
            backgroundColor: theme.surfaceSubtle,
            borderLeftColor: theme.primary,
          },
        ]}
      >
        {block.lines.map((lineSpans, idx) => (
          <Text key={idx} selectable style={[styles.quoteText, { color: theme.mutedForeground }]}>
            {renderSpans(lineSpans, theme)}
          </Text>
        ))}
      </View>
    );
  }

  if (block.type === "list") {
    return (
      <View style={styles.list}>
        {block.items.map((itemSpans, idx) => (
          <View key={idx} style={styles.listRow}>
            <Text style={[styles.listBullet, { color: theme.signalText }]}>
              {block.ordered ? `${idx + 1}.` : "•"}
            </Text>
            <Text selectable style={[styles.paragraph, styles.listItemText, { color: theme.foreground }]}>
              {renderSpans(itemSpans, theme)}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  if (block.type === "code") {
    return <CodeBlockCard code={block.code} language={block.language} theme={theme} />;
  }

  if (block.type === "math") {
    return <MathBlockCard latex={block.latex} theme={theme} />;
  }

  if (block.type === "table") {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tableScroll, { borderColor: theme.border, backgroundColor: theme.surface }]}
      >
        <View>
          <View style={[styles.tableRow, { backgroundColor: theme.surfaceSubtle, borderBottomColor: theme.border }]}>
            {block.headers.map((header, hIdx) => (
              <View key={hIdx} style={[styles.tableCell, hIdx > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border } : null]}>
                <Text selectable style={[styles.tableHeaderText, { color: theme.foreground }]}>
                  {header}
                </Text>
              </View>
            ))}
          </View>
          {block.rows.map((row, rIdx) => (
            <View
              key={rIdx}
              style={[
                styles.tableRow,
                rIdx < block.rows.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border } : null,
              ]}
            >
              {block.headers.map((_, cIdx) => (
                <View key={cIdx} style={[styles.tableCell, cIdx > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border } : null]}>
                  <Text selectable style={[styles.tableCellText, { color: theme.mutedForeground }]}>
                    {row[cIdx] ?? ""}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <Text selectable style={[styles.paragraph, { color: isUser ? theme.foreground : theme.foreground }]}>
      {renderSpans(block.spans, theme)}
    </Text>
  );
}

function CodeBlockCard({
  code,
  language,
  theme,
}: {
  code: string;
  language: string;
  theme: AppTheme;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    await successTap();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View
      style={[
        styles.codeBlock,
        { backgroundColor: theme.codeBackground, borderColor: theme.border },
      ]}
    >
      <View
        style={[
          styles.codeHeader,
          { backgroundColor: theme.codeHeader, borderBottomColor: theme.border },
        ]}
      >
        <Text style={[styles.codeLang, { color: theme.tertiaryForeground }]}>
          {language || "code"}
        </Text>
        <Pressable hitSlop={6} onPress={handleCopy}>
          <Text style={[styles.codeCopy, { color: theme.signalText }]}>
            {copied ? "已复制" : "复制代码"}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text selectable style={[styles.codeBody, { color: theme.foreground }]}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

function MathBlockCard({ latex, theme }: { latex: string; theme: AppTheme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(latex);
    await lightTap();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View
      style={[
        styles.mathCard,
        { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
      ]}
    >
      <View style={styles.mathHeader}>
        <Text style={[styles.mathLabel, { color: theme.signalText }]}>LaTeX 公式</Text>
        <Pressable hitSlop={6} onPress={handleCopy}>
          <Text style={[styles.codeCopy, { color: theme.signalText }]}>
            {copied ? "已复制" : "复制公式"}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.mathBody, { color: theme.foreground }]}>
          {latex}
        </Text>
      </ScrollView>
    </View>
  );
}

function renderSpans(spans: InlineSpan[], theme: AppTheme) {
  return spans.map((span, index) => {
    if (span.type === "bold") {
      return (
        <Text key={index} style={styles.bold}>
          {span.text}
        </Text>
      );
    }
    if (span.type === "italic") {
      return (
        <Text key={index} style={styles.italic}>
          {span.text}
        </Text>
      );
    }
    if (span.type === "code") {
      return (
        <Text
          key={index}
          style={[
            styles.inlineCode,
            { backgroundColor: theme.codeBackground, color: theme.signalText },
          ]}
        >
          {` ${span.text} `}
        </Text>
      );
    }
    if (span.type === "math") {
      return (
        <Text
          key={index}
          style={[
            styles.inlineMath,
            { backgroundColor: theme.primarySurface, color: theme.signalText },
          ]}
        >
          {` ${span.text} `}
        </Text>
      );
    }
    if (span.type === "link") {
      return (
        <Text
          key={index}
          onPress={() => {
            void Linking.openURL(span.url);
          }}
          style={[styles.link, { color: theme.signalText }]}
        >
          {span.text}
        </Text>
      );
    }
    return span.text;
  });
}

const styles = StyleSheet.create({
  root: {
    rowGap: 10,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  heading: {
    fontWeight: "700",
    marginTop: 2,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 23,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    rowGap: 4,
  },
  quoteText: {
    fontSize: 14,
    lineHeight: 21,
  },
  list: {
    rowGap: 6,
  },
  listRow: {
    alignItems: "flex-start",
    columnGap: 8,
    flexDirection: "row",
  },
  listBullet: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 23,
    minWidth: 16,
  },
  listItemText: {
    flex: 1,
  },
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  inlineCode: {
    borderRadius: 5,
    fontFamily: "monospace",
    fontSize: 13,
  },
  inlineMath: {
    borderRadius: 5,
    fontFamily: "monospace",
    fontSize: 13,
    fontStyle: "italic",
  },
  link: {
    textDecorationLine: "underline",
  },
  codeBlock: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  codeHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  codeLang: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "600",
  },
  codeCopy: {
    fontSize: 12,
    fontWeight: "600",
  },
  codeScroll: {
    padding: spacing.md,
  },
  codeBody: {
    fontFamily: "monospace",
    fontSize: 12.5,
    lineHeight: 19,
  },
  mathCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    rowGap: 6,
  },
  mathHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  mathLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  mathBody: {
    fontFamily: "monospace",
    fontSize: 13.5,
    lineHeight: 20,
  },
  tableScroll: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    borderBottomWidth: 0,
    flexDirection: "row",
  },
  tableCell: {
    minWidth: 96,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableHeaderText: {
    fontSize: 13,
    fontWeight: "700",
  },
  tableCellText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
