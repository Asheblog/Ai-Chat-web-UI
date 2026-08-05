import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  buildInterleavedCotNodes,
  buildToolStepTitle,
  countCotTimelineTools,
  resolveToolDisplay,
  type CotTimelineNode,
} from "@aichat/shared/cot-timeline";
import { resolveEventStatus, type ToolEvent } from "@aichat/shared/tool-events";

import type { AppTheme } from "../theme";
import { spacing } from "../theme";

type CotStepTimelineProps = {
  reasoningRaw: string;
  toolEvents: ToolEvent[];
  theme: AppTheme;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
};

export function CotStepTimeline({
  reasoningRaw,
  toolEvents,
  theme,
  isStreaming = false,
  defaultExpanded = false,
}: CotStepTimelineProps) {
  const nodes = useMemo(
    () => buildInterleavedCotNodes(reasoningRaw, toolEvents),
    [reasoningRaw, toolEvents],
  );
  const { totalToolCount, activeToolCount } = useMemo(() => countCotTimelineTools(nodes), [nodes]);
  const hasAnyData = nodes.length > 0;
  const isActive = isStreaming || activeToolCount > 0;
  const [expanded, setExpanded] = useState(defaultExpanded || isActive);

  if (!hasAnyData) {
    return null;
  }

  const toolHint = totalToolCount > 0 ? ` · ${totalToolCount} 个工具` : "";

  return (
    <View
      style={[
        styles.shell,
        {
          backgroundColor: theme.primarySurface,
          borderColor: theme.primary,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.header,
          { backgroundColor: pressed ? theme.primarySurface : "transparent" },
        ]}
      >
        <View style={styles.headerMain}>
          <MaterialCommunityIcons color={theme.primary} name="brain" size={18} />
          <Text numberOfLines={2} style={[styles.headerText, { color: theme.primary }]}>
            {expanded ? "收起" : "展开"} · 深度思考过程{toolHint}
          </Text>
          {isActive ? <ActivityIndicator color={theme.primary} size="small" /> : null}
        </View>
        <MaterialCommunityIcons
          color={theme.mutedForeground}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
        />
      </Pressable>

      {expanded ? (
        <View style={[styles.body, { borderTopColor: theme.border }]}>
          {nodes.map((node, index) => (
            <CotStepNode key={nodeKey(node, index)} node={node} theme={theme} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CotStepNode({ node, theme }: { node: CotTimelineNode; theme: AppTheme }) {
  if (node.type === "reasoning") {
    return <CotReasoningStep text={node.text} theme={theme} />;
  }
  if (node.type === "toolGroup") {
    return <CotToolGroupStep node={node} theme={theme} />;
  }
  return <CotToolStep event={node.event} theme={theme} />;
}

function CotReasoningStep({ text, theme }: { text: string; theme: AppTheme }) {
  return (
    <View style={[styles.stepCard, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons color="#F59E0B" name="lightbulb-on-outline" size={18} />
        <Text style={[styles.stepTitle, { color: theme.foreground }]}>深度思考</Text>
      </View>
      <Text style={[styles.reasoningText, { color: theme.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function CotToolStep({ event, theme }: { event: ToolEvent; theme: AppTheme }) {
  const [open, setOpen] = useState(false);
  const toolId = event.identifier || event.apiName || event.tool;
  const display = resolveToolDisplay(toolId);
  const title = buildToolStepTitle(event);
  const status = resolveEventStatus(event);
  const statusLabel = resolveStatusLabel(status);

  return (
    <View style={[styles.stepCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.toolHeader}
      >
        <View style={styles.toolHeaderMain}>
          <View style={styles.stepHeader}>
            <MaterialCommunityIcons color={theme.primary} name={resolveIconName(display.iconKey)} size={18} />
            <Text numberOfLines={2} style={[styles.stepTitle, { color: theme.foreground }]}>
              {title}
            </Text>
            <View style={[styles.statusBadge, resolveStatusStyle(status, theme)]}>
              <Text style={[styles.statusText, resolveStatusTextStyle(status, theme)]}>{statusLabel}</Text>
            </View>
          </View>
          {event.summary && !open ? (
            <Text numberOfLines={1} style={[styles.summaryText, { color: theme.mutedForeground }]}>
              {event.summary}
            </Text>
          ) : null}
        </View>
        <MaterialCommunityIcons
          color={theme.mutedForeground}
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
        />
      </Pressable>
      {open ? (
        <View style={[styles.toolBody, { borderTopColor: theme.border }]}>
          <ToolResultBody event={event} theme={theme} />
        </View>
      ) : null}
    </View>
  );
}

function CotToolGroupStep({
  node,
  theme,
}: {
  node: Extract<CotTimelineNode, { type: "toolGroup" }>;
  theme: AppTheme;
}) {
  const [open, setOpen] = useState(false);
  const display = resolveToolDisplay(node.toolType);

  return (
    <View style={[styles.stepCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.toolHeader}
      >
        <View style={styles.toolHeaderMain}>
          <View style={styles.stepHeader}>
            <MaterialCommunityIcons color={theme.primary} name={resolveIconName(display.iconKey)} size={18} />
            <Text style={[styles.stepTitle, { color: theme.foreground }]}>{display.label}</Text>
            <Text style={[styles.groupCount, { color: theme.mutedForeground }]}>
              {node.events.length} 个调用
            </Text>
          </View>
          <Text style={[styles.summaryText, { color: theme.mutedForeground }]}>{node.summaryText}</Text>
        </View>
        <MaterialCommunityIcons
          color={theme.mutedForeground}
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
        />
      </Pressable>
      {open ? (
        <View style={[styles.toolBody, { borderTopColor: theme.border }]}>
          {node.events.map((event) => (
            <CotToolStep
              key={`${event.callId ?? event.id}-${event.updatedAt ?? event.createdAt}`}
              event={event}
              theme={theme}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ToolResultBody({ event, theme }: { event: ToolEvent; theme: AppTheme }) {
  const payload =
    stringifyPayload(event.resultJson) ||
    stringifyPayload(event.resultText) ||
    stringifyPayload(event.argumentsText) ||
    stringifyPayload(event.error) ||
    stringifyPayload(event.summary);

  if (!payload) {
    return <Text style={[styles.emptyResult, { color: theme.mutedForeground }]}>暂无结果详情</Text>;
  }

  return (
    <ScrollView nestedScrollEnabled style={styles.resultScroll}>
      <Text selectable style={[styles.resultText, { color: theme.foreground }]}>
        {payload}
      </Text>
    </ScrollView>
  );
}

function nodeKey(node: CotTimelineNode, index: number) {
  if (node.type === "reasoning") {
    return `r:${node.charStart}-${node.charEnd}`;
  }
  if (node.type === "tool") {
    return `t:${node.event.callId ?? node.event.id}:${node.event.updatedAt ?? node.event.createdAt}`;
  }
  return `g:${node.toolType}:${index}:${node.events.map((event) => event.callId ?? event.id).join(",")}`;
}

function stringifyPayload(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveStatusLabel(status: ToolEvent["status"]) {
  if (status === "running") return "执行中";
  if (status === "pending") return "待审批";
  if (status === "error") return "失败";
  if (status === "rejected") return "已拒绝";
  if (status === "aborted") return "已中止";
  return "完成";
}

function resolveIconName(iconKey: ReturnType<typeof resolveToolDisplay>["iconKey"]) {
  switch (iconKey) {
    case "globe":
      return "web";
    case "search":
      return "magnify";
    case "file":
      return "file-document-outline";
    case "code":
      return "code-braces";
    case "clock":
      return "clock-outline";
    case "book":
      return "book-open-outline";
    case "lightbulb":
      return "lightbulb-on-outline";
    default:
      return "wrench-outline";
  }
}

function resolveStatusStyle(status: ToolEvent["status"], theme: AppTheme) {
  if (status === "success") {
    return { backgroundColor: theme.successSurface };
  }
  if (status === "running") {
    return { backgroundColor: theme.primarySurface };
  }
  if (status === "error") {
    return { backgroundColor: theme.dangerSurface };
  }
  if (status === "pending") {
    return { backgroundColor: theme.primarySurface };
  }
  return { backgroundColor: theme.inputBackground };
}

function resolveStatusTextStyle(status: ToolEvent["status"], theme: AppTheme) {
  if (status === "success") {
    return { color: theme.success };
  }
  if (status === "error") {
    return { color: theme.danger };
  }
  if (status === "running" || status === "pending") {
    return { color: theme.primary };
  }
  return { color: theme.mutedForeground };
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerMain: {
    alignItems: "center",
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: "row",
  },
  headerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  stepCard: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  stepHeader: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  stepTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  reasoningText: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  toolHeader: {
    alignItems: "flex-start",
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  toolHeaderMain: {
    flex: 1,
    rowGap: 4,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 18,
    paddingLeft: 26,
  },
  groupCount: {
    fontSize: 12,
    lineHeight: 18,
  },
  toolBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  resultScroll: {
    maxHeight: 220,
  },
  resultText: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
  },
  emptyResult: {
    fontSize: 12,
    lineHeight: 18,
  },
});
