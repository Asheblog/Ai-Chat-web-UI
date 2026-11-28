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

import type { AppTheme } from "../theme/tokens";
import { radii, spacing } from "../theme/tokens";

type CotTimelineProps = {
  reasoningRaw: string;
  toolEvents: ToolEvent[];
  theme: AppTheme;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
};

type ExpandSource = "user" | "auto" | "default";

function useLocalExpand(
  defaultExpanded: boolean,
  autoExpand: boolean,
  overrideExpanded: boolean | null,
) {
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
  const expanded = overrideExpanded ?? state.expanded;
  const toggle = () => setExpanded(!expanded);

  return { expanded, setExpanded, toggle };
}

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
  const [masterExpanded, setMasterExpanded] = useState<boolean | null>(null);

  const lastReasoningIndex = useMemo(() => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      if (nodes[index].type === "reasoning") return index;
    }
    return -1;
  }, [nodes]);

  if (nodes.length === 0) {
    return null;
  }

  const clearMasterOverride = () => setMasterExpanded(null);

  return (
    <View style={[styles.section, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      <View style={styles.masterHeader}>
        <View style={styles.masterTitleWrap}>
          <MaterialCommunityIcons color={theme.signalText} name="star-four-points" size={14} />
          <Text style={[styles.masterTitle, { color: theme.signalText }]}>
            过程时间轴 · {nodes.length} 步
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: masterExpanded === true }}
          onPress={() => setMasterExpanded((current) => current !== true)}
          style={[styles.masterButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <MaterialCommunityIcons
            color={theme.mutedForeground}
            name={masterExpanded === true ? "chevron-up" : "chevron-down"}
            size={15}
          />
          <Text style={[styles.masterButtonText, { color: theme.mutedForeground }]}>
            {masterExpanded === true ? "全部收起" : "全部展开"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.timelineBody}>
        <View pointerEvents="none" style={[styles.railLine, { backgroundColor: theme.borderStrong }]} />
        {nodes.map((node, index) => {
          const key = cotTimelineNodeKey(node, index);
          const dotColor = resolveDotColor(node, theme);
          if (node.type === "reasoning") {
            return (
              <View key={key} style={styles.nodeRow}>
                <View style={styles.railColumn}>
                  <View style={[styles.nodeDot, { backgroundColor: dotColor, borderColor: theme.surfaceSubtle }]} />
                </View>
                <View style={styles.nodeCard}>
                  <CotReasoningCard
                    defaultExpanded={defaultExpanded}
                    isStreamingTail={isStreaming && index === lastReasoningIndex}
                    onInteract={clearMasterOverride}
                    overrideExpanded={masterExpanded}
                    text={node.text}
                    theme={theme}
                  />
                </View>
              </View>
            );
          }
          if (node.type === "toolGroup") {
            return (
              <View key={key} style={styles.nodeRow}>
                <View style={styles.railColumn}>
                  <View style={[styles.nodeDot, { backgroundColor: dotColor, borderColor: theme.surfaceSubtle }]} />
                </View>
                <View style={styles.nodeCard}>
                  <CotToolGroupCard
                    node={node}
                    onInteract={clearMasterOverride}
                    overrideExpanded={masterExpanded}
                    theme={theme}
                  />
                </View>
              </View>
            );
          }
          return (
            <View key={key} style={styles.nodeRow}>
              <View style={styles.railColumn}>
                <View style={[styles.nodeDot, { backgroundColor: dotColor, borderColor: theme.surfaceSubtle }]} />
              </View>
              <View style={styles.nodeCard}>
                <CotToolCard
                  event={node.event}
                  onInteract={clearMasterOverride}
                  overrideExpanded={masterExpanded}
                  theme={theme}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function resolveDotColor(node: CotTimelineNode, theme: AppTheme) {
  if (node.type === "reasoning") return theme.warning;
  const status = node.type === "toolGroup" ? node.status : resolveEventStatus(node.event);
  if (status === "running" || status === "pending") return theme.primary;
  if (status === "error" || status === "rejected" || status === "aborted") return theme.danger;
  return theme.success;
}

function CotReasoningCard({
  text,
  defaultExpanded,
  isStreamingTail,
  overrideExpanded,
  onInteract,
  theme,
}: {
  text: string;
  defaultExpanded: boolean;
  isStreamingTail: boolean;
  overrideExpanded: boolean | null;
  onInteract: () => void;
  theme: AppTheme;
}) {
  const { expanded, toggle } = useLocalExpand(defaultExpanded, isStreamingTail, overrideExpanded);

  if (!text) return null;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          toggle();
          onInteract();
        }}
        style={styles.cardHeaderPress}
      >
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons color={theme.warning} name="lightbulb-on-outline" size={16} />
          <Text style={[styles.cardTitle, { color: theme.foreground }]}>深度思考</Text>
          {isStreamingTail ? <ActivityIndicator color={theme.primary} size="small" /> : null}
        </View>
        <MaterialCommunityIcons
          color={theme.tertiaryForeground}
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

function CotToolCard({
  event,
  overrideExpanded,
  onInteract,
  theme,
}: {
  event: ToolEvent;
  overrideExpanded: boolean | null;
  onInteract: () => void;
  theme: AppTheme;
}) {
  const status = resolveEventStatus(event);
  const isActive = status === "running" || status === "pending";
  const { expanded, toggle } = useLocalExpand(false, isActive, overrideExpanded);
  const toolId = event.identifier || event.apiName || event.tool;
  const display = resolveToolDisplay(toolId);
  const title = buildToolStepTitle(event);
  const statusLabel = resolveStatusLabel(status);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          toggle();
          onInteract();
        }}
        style={styles.cardHeaderPress}
      >
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons
            color={theme.primary}
            name={resolveIconName(display.iconKey)}
            size={16}
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
          <Text numberOfLines={1} style={[styles.summaryText, { color: theme.tertiaryForeground }]}>
            {event.summary}
          </Text>
        ) : null}
        <MaterialCommunityIcons
          color={theme.tertiaryForeground}
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
  overrideExpanded,
  onInteract,
  theme,
}: {
  node: Extract<CotTimelineNode, { type: "toolGroup" }>;
  overrideExpanded: boolean | null;
  onInteract: () => void;
  theme: AppTheme;
}) {
  const { expanded, toggle } = useLocalExpand(false, node.status === "running", overrideExpanded);
  const display = resolveToolDisplay(node.toolType);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          toggle();
          onInteract();
        }}
        style={styles.cardHeaderPress}
      >
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons
            color={theme.primary}
            name={resolveIconName(display.iconKey)}
            size={16}
          />
          <Text style={[styles.cardTitle, { color: theme.foreground }]}>{display.label}</Text>
          <Text style={[styles.groupCount, { color: theme.tertiaryForeground }]}>
            {node.events.length} 次调用
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.summaryText, { color: theme.tertiaryForeground }]}>
          {node.summaryText}
        </Text>
        <MaterialCommunityIcons
          color={theme.tertiaryForeground}
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
              onInteract={onInteract}
              overrideExpanded={overrideExpanded}
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
    return <Text style={[styles.emptyResult, { color: theme.tertiaryForeground }]}>暂无结果详情</Text>;
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
  if (value == null) return null;
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
  if (status === "success") return { backgroundColor: theme.successSurface };
  if (status === "running" || status === "pending") return { backgroundColor: theme.primarySurface };
  if (status === "error") return { backgroundColor: theme.dangerSurface };
  return { backgroundColor: theme.surfaceSubtle };
}

function resolveStatusTextStyle(status: ToolEvent["status"], theme: AppTheme) {
  if (status === "success") return { color: theme.success };
  if (status === "error") return { color: theme.danger };
  if (status === "running" || status === "pending") return { color: theme.signalText };
  return { color: theme.mutedForeground };
}

const styles = StyleSheet.create({
  section: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  masterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  masterTitleWrap: {
    alignItems: "center",
    columnGap: 6,
    flexDirection: "row",
  },
  masterTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  masterButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 3,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  masterButtonText: {
    fontSize: 11,
    fontWeight: "600",
  },
  timelineBody: {
    position: "relative",
    rowGap: spacing.sm,
  },
  railLine: {
    bottom: 18,
    left: 7,
    position: "absolute",
    top: 18,
    width: 1,
  },
  nodeRow: {
    alignItems: "stretch",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  railColumn: {
    alignItems: "center",
    paddingTop: 18,
    width: 16,
  },
  nodeDot: {
    borderRadius: 4,
    borderWidth: 2,
    height: 8,
    width: 8,
  },
  nodeCard: {
    flex: 1,
  },
  card: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardHeaderPress: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
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
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  reasoningText: {
    borderTopWidth: StyleSheet.hairlineWidth,
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.md,
  },
  statusBadge: {
    borderRadius: radii.pill,
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
    lineHeight: 17,
  },
  groupCount: {
    fontSize: 11,
    lineHeight: 17,
  },
  cardBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  resultScroll: {
    maxHeight: 200,
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
