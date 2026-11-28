import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
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
              <Pressable hitSlop={6} onPress={() => onDetachDocument(doc.id)}>
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
        <Pressable
          accessibilityLabel="添加图片或文档"
          accessibilityRole="button"
          onPress={() => {
            void lightTap();
            setAttachMenuOpen(true);
          }}
          style={[
            styles.roundIconBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons color={theme.mutedForeground} name="plus" size={20} />
        </Pressable>

        <TextInput
          multiline
          onChangeText={onChangeText}
          placeholder="输入消息、粘贴链接或附带图片文档…"
          placeholderTextColor={theme.tertiaryForeground}
          style={[styles.input, { color: theme.foreground }]}
          textAlignVertical="center"
          value={value}
        />

        <Pressable
          accessibilityLabel="语音输入"
          accessibilityRole="button"
          onPress={() => {
            void lightTap();
            onPressVoice();
          }}
          style={styles.voiceBtn}
        >
          <MaterialCommunityIcons
            color={isListeningVoice ? theme.danger : theme.mutedForeground}
            name={isListeningVoice ? "microphone" : "microphone-outline"}
            size={20}
          />
        </Pressable>

        {isStreaming ? (
          <Pressable
            accessibilityLabel="停止生成"
            accessibilityRole="button"
            onPress={onStop}
            style={[styles.sendBtn, { backgroundColor: theme.danger }]}
          >
            <MaterialCommunityIcons color="#FFFFFF" name="stop" size={18} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            disabled={!canSend}
            onPress={onSend}
            style={[
              styles.sendBtn,
              {
                backgroundColor: canSend ? theme.primary : theme.borderStrong,
              },
            ]}
          >
            <MaterialCommunityIcons
              color={canSend ? theme.primaryForeground : theme.surface}
              name="arrow-up"
              size={18}
            />
          </Pressable>
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
    paddingVertical: 7,
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
