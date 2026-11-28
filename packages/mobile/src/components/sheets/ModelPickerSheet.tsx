import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { selectionTap } from "../../native/haptics";
import type { ModelItem } from "../../session-types";
import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";
import { Badge, BottomSheetModal } from "../ui/UiPrimitives";

export function ModelPickerSheet({
  visible,
  models,
  selectedModelId,
  onSelectModel,
  onClose,
  theme,
}: {
  visible: boolean;
  models: ModelItem[];
  selectedModelId: string | null;
  onSelectModel: (model: ModelItem) => void;
  onClose: () => void;
  theme: AppTheme;
}) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const usable = models.filter(
      (m) => m.modelType !== "embedding" && m.accessDecision !== "deny",
    );
    const filtered = q
      ? usable.filter((m) =>
          `${m.name} ${m.rawId} ${m.channelName ?? ""} ${m.provider}`
            .toLowerCase()
            .includes(q),
        )
      : usable;

    const groups = new Map<string, ModelItem[]>();
    for (const model of filtered) {
      const groupName = model.channelName || model.provider || "默认模型组";
      const bucket = groups.get(groupName) ?? [];
      bucket.push(model);
      groups.set(groupName, bucket);
    }
    return Array.from(groups.entries());
  }, [models, query]);

  return (
    <BottomSheetModal
      onClose={onClose}
      subtitle={`共 ${models.filter((m) => m.modelType !== "embedding" && m.accessDecision !== "deny").length} 个可用模型`}
      theme={theme}
      title="选择对话模型"
      visible={visible}
    >
      <View
        style={[
          styles.searchBox,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <MaterialCommunityIcons color={theme.tertiaryForeground} name="magnify" size={18} />
        <TextInput
          onChangeText={setQuery}
          placeholder="搜索 DeepSeek / Claude / GPT / Gemini…"
          placeholderTextColor={theme.tertiaryForeground}
          style={[styles.searchInput, { color: theme.foreground }]}
          value={query}
        />
      </View>

      {grouped.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.tertiaryForeground }]}>
          未找到匹配的可用模型。
        </Text>
      ) : (
        grouped.map(([groupName, items]) => (
          <View key={groupName} style={styles.group}>
            <Text style={[styles.groupTitle, { color: theme.tertiaryForeground }]}>
              {groupName}
            </Text>
            {items.map((model) => {
              const active =
                model.id === selectedModelId || model.rawId === selectedModelId;
              return (
                <Pressable
                  key={`${model.connectionId ?? "x"}-${model.id}`}
                  onPress={() => {
                    void selectionTap();
                    onSelectModel(model);
                    onClose();
                  }}
                  style={[
                    styles.item,
                    {
                      backgroundColor: active ? theme.primarySurface : theme.background,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <View style={styles.itemBody}>
                    <View style={styles.itemTop}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.itemTitle,
                          { color: active ? theme.signalText : theme.foreground },
                        ]}
                      >
                        {model.name || model.rawId}
                      </Text>
                      {active ? (
                        <MaterialCommunityIcons
                          color={theme.signalText}
                          name="check-circle"
                          size={18}
                        />
                      ) : null}
                    </View>
                    <View style={styles.badgeRow}>
                      <Badge label={model.provider} theme={theme} />
                      {model.capabilities?.reasoning ? (
                        <Badge label="推理" theme={theme} tone="signal" />
                      ) : null}
                      {model.capabilities?.vision ? (
                        <Badge label="视觉" theme={theme} tone="success" />
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))
      )}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  emptyText: {
    fontSize: 14,
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
  group: {
    rowGap: 8,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  item: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  itemBody: {
    rowGap: 6,
  },
  itemTop: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  badgeRow: {
    columnGap: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 4,
  },
});
