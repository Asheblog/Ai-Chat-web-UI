import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";
import type {
  KnowledgeBaseItem,
  McpSessionTool,
  ReasoningEffort,
  SkillOptionItem,
} from "../../types/mobile";
import {
  Badge,
  BottomSheetModal,
  Button,
  SegmentedControl,
  SwitchRow,
} from "../ui/UiPrimitives";

export function SessionExtensionsSheet({
  visible,
  onClose,
  theme,
  reasoningEnabled,
  onChangeReasoningEnabled,
  reasoningEffort,
  onChangeReasoningEffort,
  webSearchEnabled,
  onChangeWebSearchEnabled,
  knowledgeBases,
  selectedKbIds,
  onToggleKb,
  skills,
  enabledSkillIds,
  onToggleSkill,
  mcpTools,
  systemPrompt,
  onSaveSystemPrompt,
}: {
  visible: boolean;
  onClose: () => void;
  theme: AppTheme;
  reasoningEnabled: boolean;
  onChangeReasoningEnabled: (v: boolean) => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (v: ReasoningEffort) => void;
  webSearchEnabled: boolean;
  onChangeWebSearchEnabled: (v: boolean) => void;
  knowledgeBases: KnowledgeBaseItem[];
  selectedKbIds: number[];
  onToggleKb: (id: number) => void;
  skills: SkillOptionItem[];
  enabledSkillIds: number[];
  onToggleSkill: (skill: SkillOptionItem) => void;
  mcpTools: McpSessionTool[];
  systemPrompt: string;
  onSaveSystemPrompt: (nextPrompt: string) => Promise<void>;
}) {
  const [draftPrompt, setDraftPrompt] = useState(systemPrompt);
  const [savingPrompt, setSavingPrompt] = useState(false);

  useEffect(() => {
    setDraftPrompt(systemPrompt);
  }, [systemPrompt, visible]);

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      await onSaveSystemPrompt(draftPrompt.trim());
    } finally {
      setSavingPrompt(false);
    }
  };

  return (
    <BottomSheetModal
      onClose={onClose}
      subtitle="配置当前会话的推理力度、联网检索、知识库与 Skill/MCP"
      theme={theme}
      title="会话能力与扩展"
      visible={visible}
    >
      <SwitchRow
        subtitle="启用模型思维链并展示 CoT 时间轴"
        theme={theme}
        title="深度思考 (Reasoning)"
        value={reasoningEnabled}
        onValueChange={onChangeReasoningEnabled}
      />

      {reasoningEnabled ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            推理深度
          </Text>
          <SegmentedControl
            onChange={onChangeReasoningEffort}
            options={[
              { value: "low", label: "低" },
              { value: "medium", label: "标准" },
              { value: "high", label: "深度" },
            ]}
            theme={theme}
            value={
              reasoningEffort === "low" || reasoningEffort === "high"
                ? reasoningEffort
                : "medium"
            }
          />
        </View>
      ) : null}

      <SwitchRow
        subtitle="通过服务端内置 web-search 工具检索实时网页"
        theme={theme}
        title="联网搜索 (Web Search)"
        value={webSearchEnabled}
        onValueChange={onChangeWebSearchEnabled}
      />

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
          关联知识库 ({selectedKbIds.length} 已选)
        </Text>
        {knowledgeBases.length === 0 ? (
          <Text style={[styles.emptyHint, { color: theme.tertiaryForeground }]}>
            当前账号暂无可用知识库（或服务端未启用 RAG）。
          </Text>
        ) : (
          knowledgeBases.map((kb) => {
            const active = selectedKbIds.includes(kb.id);
            return (
              <Pressable
                key={kb.id}
                onPress={() => onToggleKb(kb.id)}
                style={[
                  styles.selectRow,
                  {
                    backgroundColor: active ? theme.primarySurface : theme.background,
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
              >
                <View style={styles.selectTextCol}>
                  <Text
                    style={[
                      styles.selectTitle,
                      { color: active ? theme.signalText : theme.foreground },
                    ]}
                  >
                    {kb.name}
                  </Text>
                  {kb.description ? (
                    <Text
                      numberOfLines={1}
                      style={[styles.selectSub, { color: theme.tertiaryForeground }]}
                    >
                      {kb.description}
                    </Text>
                  ) : null}
                </View>
                <Badge
                  label={active ? "已启用" : "未选"}
                  theme={theme}
                  tone={active ? "signal" : "neutral"}
                />
              </Pressable>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
          会话 Skill ({enabledSkillIds.length}/{skills.length})
        </Text>
        {skills.length === 0 ? (
          <Text style={[styles.emptyHint, { color: theme.tertiaryForeground }]}>
            当前账号暂无自定义 Skill。
          </Text>
        ) : (
          skills.map((skill) => {
            const active = enabledSkillIds.includes(skill.id);
            return (
              <SwitchRow
                key={skill.id}
                onValueChange={() => onToggleSkill(skill)}
                subtitle={skill.description || skill.slug}
                theme={theme}
                title={skill.displayName || skill.slug}
                value={active}
              />
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
          当前会话可用 MCP 工具 ({mcpTools.length})
        </Text>
        {mcpTools.length === 0 ? (
          <Text style={[styles.emptyHint, { color: theme.tertiaryForeground }]}>
            未检测到已绑定的 MCP 工具，可在 Web 端「工具与扩展」管理。
          </Text>
        ) : (
          <View style={styles.mcpWrap}>
            {mcpTools.map((tool, idx) => (
              <Badge
                key={`${tool.connectionId ?? "m"}-${tool.name ?? idx}`}
                label={tool.name || tool.originalName || "tool"}
                theme={theme}
                tone="signal"
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
          当前会话系统提示词 (System Prompt)
        </Text>
        <TextInput
          multiline
          onChangeText={setDraftPrompt}
          placeholder="可选：为本对话设置专属角色或输出规范…"
          placeholderTextColor={theme.tertiaryForeground}
          style={[
            styles.promptInput,
            {
              backgroundColor: theme.background,
              borderColor: theme.borderStrong,
              color: theme.foreground,
            },
          ]}
          value={draftPrompt}
        />
        <Button
          disabled={savingPrompt || draftPrompt.trim() === systemPrompt.trim()}
          label="保存会话提示词"
          loading={savingPrompt}
          onPress={handleSavePrompt}
          theme={theme}
          variant="soft"
        />
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  section: {
    rowGap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  emptyHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  selectRow: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    columnGap: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectTextCol: {
    flex: 1,
    rowGap: 2,
  },
  selectTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  selectSub: {
    fontSize: 12,
  },
  mcpWrap: {
    columnGap: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 6,
  },
  promptInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 84,
    padding: spacing.md,
    textAlignVertical: "top",
  },
});
