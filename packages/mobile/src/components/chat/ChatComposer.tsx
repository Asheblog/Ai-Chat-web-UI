import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ChatMessage } from "../../chat-types";
import { lightTap } from "../../native/haptics";
import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";
import type { PendingImageAttachment, SessionDocumentItem } from "../../types/mobile";
import { ActionMenuModal } from "../ui/UiPrimitives";

type ChatComposerProps = {
  theme: AppTheme;
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  canSend: boolean;
  reasoningEnabled: boolean;
  onToggleReasoning: () => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  selectedKbCount: number;
  selectedSkillsCount: number;
  onOpenExtensions: () => void;
  pendingImages: PendingImageAttachment[];
  onRemoveImage: (id: string) => void;
  onPickCamera: () => void;
  onPickGallery: () => void;
  onPickDocument: () => void;
  isUploadingDoc: boolean;
  sessionDocuments: SessionDocumentItem[];
  onDetachDocument: (docId: number) => void;
  replyToMessage: ChatMessage | null;
  onClearReply: () => void;
  isListeningVoice: boolean;
  onPressVoice: () => void;
  bottomInset?: number;
};

export function ChatComposer({
  theme,
  value,
  onChangeText,
  onSend,
  onStop,
  isStreaming,
  canSend,
  reasoningEnabled,
  onToggleReasoning,
  webSearchEnabled,
  onToggleWebSearch,
  selectedKbCount,
  selectedSkillsCount,
  onOpenExtensions,
  pendingImages,
  onRemoveImage,
  onPickCamera,
  onPickGallery,
  onPickDocument,
  isUploadingDoc,
  sessionDocuments,
  onDetachDocument,
  replyToMessage,
  onClearReply,
  isListeningVoice,
  onPressVoice,
  bottomInset = 0,
}: ChatComposerProps) {
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  return (
    <View
      style={[
        styles.wrapper,
        {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          paddingBottom: Math.max(spacing.md, bottomInset + 6),
        },
      ]}
    >
      {replyToMessage ? (
        <View
          style={[
            styles.replyBanner,
            { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons color={theme.signalText} name="reply" size={16} />
          <Text numberOfLines={1} style={[styles.replyText, { color: theme.mutedForeground }]}>
            引用：{replyToMessage.content.trim() || "历史消息"}
          </Text>
          <Pressable hitSlop={8} onPress={onClearReply}>
            <MaterialCommunityIcons color={theme.tertiaryForeground} name="close" size={16} />
          </Pressable>
        </View>
      ) : null}

      {pendingImages.length > 0 || sessionDocuments.length > 0 || isUploadingDoc ? (
        <ScrollView
          contentContainerStyle={styles.attachmentStrip}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {pendingImages.map((img) => (
            <View key={img.id} style={styles.thumbWrap}>
              <Image source={{ uri: img.uri }} style={styles.thumbImg} />
              <Pressable
                accessibilityLabel="移除图片附件"
                accessibilityRole="button"
                hitSlop={13}
                onPress={() => onRemoveImage(img.id)}
                style={[styles.thumbRemove, { backgroundColor: theme.foreground }]}
              >
                <MaterialCommunityIcons color={theme.surface} name="close" size={12} />
              </Pressable>
            </View>
          ))}
          {sessionDocuments.map((doc) => (
            <View
              key={doc.id}
              style={[
                styles.docChip,
                { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons color={theme.signalText} name="file-document-outline" size={14} />
              <Text numberOfLines={1} style={[styles.docChipText, { color: theme.foreground }]}>
                {doc.originalName || doc.filename}
              </Text>
              <Pressable
                accessibilityLabel={`移除文档附件 ${doc.originalName || doc.filename}`}
                accessibilityRole="button"
                hitSlop={15}
                onPress={() => onDetachDocument(doc.id)}
              >
                <MaterialCommunityIcons color={theme.tertiaryForeground} name="close" size={14} />
              </Pressable>
            </View>
          ))}
          {isUploadingDoc ? (
            <View
              style={[
                styles.docChip,
                { backgroundColor: theme.primarySurface, borderColor: theme.primary },
              ]}
            >
              <ActivityIndicator color={theme.primary} size="small" />
              <Text style={[styles.docChipText, { color: theme.signalText }]}>正在上传文档…</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.chipRow}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <ComposerChip
          active={reasoningEnabled}
          icon="star-four-points"
          label="深度思考"
          onPress={() => {
            void lightTap();
            onToggleReasoning();
          }}
          theme={theme}
        />
        <ComposerChip
          active={webSearchEnabled}
          icon="web"
          label="联网搜索"
          onPress={() => {
            void lightTap();
            onToggleWebSearch();
          }}
          theme={theme}
        />
        <ComposerChip
          active={selectedKbCount > 0}
          icon="book-open-outline"
          label={selectedKbCount > 0 ? `知识库(${selectedKbCount})` : "知识库"}
          onPress={() => {
            void lightTap();
            onOpenExtensions();
          }}
          theme={theme}
        />
        <ComposerChip
          active={selectedSkillsCount > 0}
          icon="tune-variant"
          label={selectedSkillsCount > 0 ? `扩展(${selectedSkillsCount})` : "扩展与参数"}
          onPress={() => {
            void lightTap();
            onOpenExtensions();
          }}
          theme={theme}
        />
      </ScrollView>

      <View
        style={[
          styles.inputBox,
          { backgroundColor: theme.background, borderColor: theme.borderStrong },
        ]}
      >
        <ComposerAction
          label="添加图片或文档"
          onPress={() => {
            void lightTap();
            setAttachMenuOpen(true);
          }}
        >
          <View
            style={[
              styles.roundIconBtn,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <MaterialCommunityIcons color={theme.mutedForeground} name="plus" size={20} />
          </View>
        </ComposerAction>

        <TextInput
          multiline
          onChangeText={onChangeText}
          placeholder="输入消息、粘贴链接或附带图片文档…"
          placeholderTextColor={theme.tertiaryForeground}
          style={[styles.input, { color: theme.foreground }]}
          textAlignVertical="center"
          value={value}
        />

        <ComposerAction
          label="语音输入"
          onPress={() => {
            void lightTap();
            onPressVoice();
          }}
          selected={isListeningVoice}
        >
          <View style={styles.voiceBtn}>
            <MaterialCommunityIcons
              color={isListeningVoice ? theme.danger : theme.mutedForeground}
              name={isListeningVoice ? "microphone" : "microphone-outline"}
              size={20}
            />
          </View>
        </ComposerAction>

        {isStreaming ? (
          <ComposerAction label="停止生成" onPress={onStop}>
            <View style={[styles.sendBtn, { backgroundColor: theme.danger }]}>
              <MaterialCommunityIcons color="#FFFFFF" name="stop" size={18} />
            </View>
          </ComposerAction>
        ) : (
          <ComposerAction
            disabled={!canSend}
            label="发送消息"
            onPress={onSend}
          >
            <View
              style={[
                styles.sendBtn,
                {
                  backgroundColor: canSend ? theme.primary : theme.borderStrong,
                  opacity: canSend ? 1 : 0.65,
                },
              ]}
            >
              <MaterialCommunityIcons
                color={canSend ? theme.primaryForeground : theme.surface}
                name="arrow-up"
                size={18}
              />
            </View>
          </ComposerAction>
        )}
      </View>

      <ActionMenuModal
        items={[
          {
            id: "camera",
            label: "拍照并发送图片",
            icon: "camera-outline",
            onPress: onPickCamera,
          },
          {
            id: "gallery",
            label: "从相册选择图片（支持多选）",
            icon: "image-multiple-outline",
            onPress: onPickGallery,
          },
          {
            id: "doc",
            label: "上传文档到当前会话（PDF/TXT/MD 等）",
            icon: "file-upload-outline",
            onPress: onPickDocument,
          },
        ]}
        onClose={() => setAttachMenuOpen(false)}
        theme={theme}
        title="添加多模态附件"
        visible={attachMenuOpen}
      />
    </View>
  );
}

type ComposerActionProps = {
  label: string;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
  selected?: boolean;
};

/**
 * Composer 主操作的统一触控盒：视觉尺寸仍由 children 决定（34px 圆形 / 20px 图标），
 * 但布局盒固定 44×44，且与相邻操作保持 8px token 间隔，不使用相互重叠的 hitSlop。
 */
export function ComposerAction({
  label,
  onPress,
  children,
  disabled,
  selected,
}: ComposerActionProps) {
  const accessibilityState: { disabled?: boolean; selected?: boolean } = {};
  if (typeof disabled === "boolean") accessibilityState.disabled = disabled;
  if (typeof selected === "boolean") accessibilityState.selected = selected;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      {...(Object.keys(accessibilityState).length > 0 ? { accessibilityState } : {})}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.touchTarget,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

function ComposerChip({
  label,
  icon,
  active,
  onPress,
  theme,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  active: boolean;
  onPress: () => void;
  theme: AppTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.primarySurface : theme.surfaceSubtle,
          borderColor: active ? theme.primary : theme.border,
        },
      ]}
    >
      <MaterialCommunityIcons
        color={active ? theme.signalText : theme.mutedForeground}
        name={icon}
        size={13}
      />
      <Text
        style={[
          styles.chipText,
          { color: active ? theme.signalText : theme.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    rowGap: 8,
  },
  replyBanner: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  replyText: {
    flex: 1,
    fontSize: 12,
  },
  attachmentStrip: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    paddingVertical: 2,
  },
  thumbWrap: {
    position: "relative",
  },
  thumbImg: {
    borderRadius: radii.sm,
    height: 56,
    width: 56,
  },
  thumbRemove: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: -4,
    top: -4,
    width: 18,
  },
  docChip: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 6,
    flexDirection: "row",
    maxWidth: 190,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  docChipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "500",
  },
  chipRow: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
  },
  chip: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 5,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  inputBox: {
    alignItems: "flex-end",
    borderRadius: radii.lg,
    borderWidth: 1,
    columnGap: 8,
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  /** 视觉保持 34px 圆形，但每个主操作获得 44×44 的实际布局盒（不重叠，间隔沿用 8px token）。 */
  touchTarget: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pressed: {
    opacity: 0.72,
  },
  roundIconBtn: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 120,
    minHeight: 34,
    paddingVertical: 4,
  },
  voiceBtn: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 30,
  },
  sendBtn: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
});
