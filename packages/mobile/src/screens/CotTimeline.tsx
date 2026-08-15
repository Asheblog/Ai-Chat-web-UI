import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
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
  cotTimelineNodeKey,
  resolveToolDisplay,
  type CotTimelineNode,
} from "@aichat/shared/cot-timeline";
import { resolveEventStatus, type ToolEvent } from "@aichat/shared/tool-events";

import type { AppTheme } from "../theme";
import { spacing } from "../theme";

type CotTimelineProps = {
  reasoningRaw: string;
  toolEvents: ToolEvent[];
  theme: AppTheme;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
};

type ExpandSource = "user" | "auto" | "default";

function useLocalExpand(defaultExpanded: boolean, autoExpand: boolean) {
  const [state, setState] = useState<{ expanded: boolean; source: ExpandSource }>({
    expanded: defaultExpanded || autoExpand,
    source: autoExpand ? "auto" : "default",
  });

  useEffect(() => {
    setState((prev) => {
      if (prev.source === "user") return prev;
      if (autoExpand) {
        return prev.expanded ? prev : { expanded: true, source: "auto" };
      }
      if (prev.expanded === defaultExpanded && prev.source === "default") return prev;
      return { expanded: defaultExpanded, source: "default" };
    });
  }, [autoExpand, defaultExpanded]);

  const setExpanded = (next: boolean) => setState({ expanded: next, source: "user" });
  const toggle = () => setState((prev) => ({ expanded: !prev.expanded, source: "user" }));

  return { expanded: state.expanded, setExpanded, toggle };
}

/**
 * 统一 CoT 时间轴：每个 reasoning / tool / toolGroup 节点都是平铺兄弟卡片，
 * 各自独立折叠；与 Web `CotTimeline` 使用同一 shared 节点构建器。
 */
export function CotTimeline({
  reasoningRaw,
  toolEvents,
  theme,
  isStreaming = false,
  defaultExpanded = false,
}: CotTimelineProps) {
  const nodes = useMemo(
    () => buildInterleavedCotNodes(reasoningRaw, toolEvents),
    [reasoningRaw, toolEvents],
  );

  const lastReasoningIndex = useMemo(() => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      if (nodes[index].type === "reasoning") return index;
    }
    return -1;
  }, [nodes]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <View style={styles.timeline}>
      {nodes.map((node, index) => {
        const key = cotTimelineNodeKey(node, index);
        if (node.type === "reasoning") {
          return (
            <CotReasoningCard
              key={key}
              defaultExpanded={defaultExpanded}
              isStreamingTail={isStreaming && index === lastReasoningIndex}
              text={node.text}
              theme={theme}
            />
          );
        }
        if (node.type === "toolGroup") {
          return <CotToolGroupCard key={key} node={node} theme={theme} />;
        }
        return <CotToolCard key={key} event={node.event} theme={theme} />;
      })}
    </View>
  );
}

function CotReasoningCard({
  text,
  defaultExpanded,
  isStreamingTail,
  theme,
}: {
  text: string;
  defaultExpanded: boolean;
  isStreamingTail: boolean;
  theme: AppTheme;
}) {
  const { expanded, toggle } = useLocalExpand(defaultExpanded, isStreamingTail);

  if (!text) return null;

  return (
    <View style={[styles.card, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.cardHeaderPress}
      >
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons color="#F59E0B" name="lightbulb-on-outline" size={18} />
          <Text style={[styles.cardTitle, { color: theme.foreground }]}>深度思考</Text>
          {isStreamingTail ? <ActivityIndicator color={theme.primary} size="small" /> : null}
        </View>
        <MaterialCommunityIcons
          color={theme.mutedForeground}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
        />
      </Pressable>
      {expanded ? (
        <Text
          selectable
          style={[
            styles.reasoningText,
            { borderTopColor: theme.border, color: theme.mutedForeground },
          ]}
        >
          {text}
        </Text>
      ) : null}
    </View>
  );
}

function CotToolCard({ event, theme }: { event: ToolEvent; theme: AppTheme }) {
  const status = resolveEventStatus(event);
  const isActive = status === "running" || status === "pending";
  const { expanded, toggle } = useLocalExpand(false, isActive);
  const toolId = event.identifier || event.apiName || event.tool;
  const display = resolveToolDisplay(toolId);
  const title = buildToolStepTitle(event);
  const statusLabel = resolveStatusLabel(status);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.cardHeaderPress}
      >
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons
            color={theme.primary}
            name={resolveIconName(display.iconKey)}
            size={18}
          />
          <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.foreground }]}>
            {title}
          </Text>
          <View style={[styles.statusBadge, resolveStatusStyle(status, theme)]}>
            <Text style={[styles.statusText, resolveStatusTextStyle(status, theme)]}>
              {statusLabel}
            </Text>
          </View>
        </View>
        {event.summary && !expanded ? (
          <Text numberOfLines={1} style={[styles.summaryText, { color: theme.mutedForeground }]}>
            {event.summary}
          </Text>
        ) : null}
        <MaterialCommunityIcons
          color={theme.mutedForeground}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
        />
      </Pressable>
      {expanded ? (
        <View style={[styles.cardBody, { borderTopColor: theme.border }]}>
          <ToolResultBody event={event} theme={theme} />
        </View>
      ) : null}
    </View>
  );
}

function CotToolGroupCard({
  node,
  theme,
}: {
  node: Extract<CotTimelineNode, { type: "toolGroup" }>;
  theme: AppTheme;
}) {
  const { expanded, toggle } = useLocalExpand(false, node.status === "running");
  const display = resolveToolDisplay(node.toolType);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.cardHeaderPress}
      >
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons
            color={theme.primary}
            name={resolveIconName(display.iconKey)}
            size={18}
          />
          <Text style={[styles.cardTitle, { color: theme.foreground }]}>{display.label}</Text>
          <Text style={[styles.groupCount, { color: theme.mutedForeground }]}>
            {node.events.length} 个调用
          </Text>
        </View>
        <Text style={[styles.summaryText, { color: theme.mutedForeground }]}>{node.summaryText}</Text>
        <MaterialCommunityIcons
          color={theme.mutedForeground}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
        />
      </Pressable>
      {expanded ? (
        <View style={[styles.cardBody, { borderTopColor: theme.border }]}>
          {node.events.map((event) => (
            <CotToolCard
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
  timeline: {
    rowGap: spacing.sm,
  },
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardHeaderPress: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    padding: spacing.md,
  },
  cardHeader: {
    alignItems: "center",
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  reasoningText: {
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    lineHeight: 21,
    padding: spacing.md,
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
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  groupCount: {
    fontSize: 12,
    lineHeight: 18,
  },
  cardBody: {
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
