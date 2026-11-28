import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ChatMessage } from "../chat-types";
import { RichMarkdown } from "../components/chat/RichMarkdown";
import { ActionMenuModal, type ActionMenuItem } from "../components/ui/UiPrimitives";
import { lightTap, successTap } from "../native/haptics";
import type { AppTheme } from "../theme/tokens";
import { radii, spacing } from "../theme/tokens";
import { CotTimeline } from "./CotTimeline";
import { contentToText } from "./chat-message-utils";

type MessageBubbleProps = {
  message: ChatMessage;
  endpoint: string;
  theme: AppTheme;
  onRetry?: (message: ChatMessage) => void;
  onReply?: (message: ChatMessage) => void;
  onPreviewImage?: (uri: string) => void;
};

function resolveImageUri(src: string, endpoint: string): string {
  if (/^(https?:|data:|file:)/i.test(src)) {
    return src;
  }
  const cleanEndpoint = endpoint.replace(/\/+$/, "");
  const cleanSrc = src.startsWith("/") ? src : `/${src}`;
  return `${cleanEndpoint}${cleanSrc}`;
}

export function MessageBubble({
  message,
  endpoint,
  theme,
  onRetry,
  onReply,
  onPreviewImage,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === "user";
  const isStreaming = message.streamStatus === "streaming";
  const text = contentToText(message.content);
  const reasoning = typeof message.reasoning === "string" ? message.reasoning : "";
  const toolEvents = message.toolEvents ?? [];
  const hasTimeline = reasoning.trim().length > 0 || toolEvents.length > 0;
  const userImages = Array.isArray(message.images) ? message.images : [];
  const generatedImages = Array.isArray(message.generatedImages) ? message.generatedImages : [];

  const handleCopyAll = async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    await successTap();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleShare = async () => {
    if (!text) return;
    await lightTap();
    try {
      await Share.share({ message: text });
    } catch {}
  };

  const menuItems: ActionMenuItem[] = [
    ...(text
      ? [
          {
            id: "copy",
            label: "复制消息内容",
            icon: "content-copy" as const,
            onPress: () => void handleCopyAll(),
          },
        ]
      : []),
    ...(onReply
      ? [
          {
            id: "reply",
            label: "引用回复",
            icon: "reply-outline" as const,
            onPress: () => {
              void lightTap();
              onReply(message);
            },
          },
        ]
      : []),
    ...(!isUser && onRetry && typeof message.id === "number"
      ? [
          {
            id: "retry",
            label: "重新生成回复",
            icon: "refresh" as const,
            onPress: () => {
              void lightTap();
              onRetry(message);
            },
          },
        ]
      : []),
    ...(text
      ? [
          {
            id: "share",
            label: "系统分享",
            icon: "share-variant-outline" as const,
            onPress: () => void handleShare(),
          },
        ]
      : []),
  ];

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <Pressable
          onLongPress={() => {
            void lightTap();
            setMenuOpen(true);
          }}
          style={[
            styles.userBubble,
            {
              backgroundColor: theme.userBubble,
              borderColor: theme.border,
            },
          ]}
        >
          {userImages.length > 0 ? (
            <View style={styles.thumbGrid}>
              {userImages.map((img, idx) => {
                const uri = resolveImageUri(img, endpoint);
                return (
                  <Pressable key={idx} onPress={() => onPreviewImage?.(uri)}>
                    <Image source={{ uri }} style={styles.userThumb} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {text ? (
            <Text selectable style={[styles.userText, { color: theme.foreground }]}>
              {text}
            </Text>
          ) : null}
        </Pressable>
        <ActionMenuModal
          items={menuItems}
          onClose={() => setMenuOpen(false)}
          theme={theme}
          title="消息操作"
          visible={menuOpen}
        />
      </View>
    );
  }

  return (
    <Pressable
      onLongPress={() => {
        if (menuItems.length > 0) {
          void lightTap();
          setMenuOpen(true);
        }
      }}
      style={styles.assistantWrap}
    >
      <View style={styles.assistantHeader}>
        <View style={[styles.avatar, { backgroundColor: theme.avatarBackground }]}>
          <Text style={[styles.avatarLabel, { color: theme.signalText }]}>AI</Text>
        </View>
        <Text style={[styles.roleText, { color: theme.mutedForeground }]}>AIChat 助手</Text>
        {isStreaming ? <ActivityIndicator color={theme.primary} size="small" /> : null}
      </View>

      {hasTimeline ? (
        <CotTimeline
          defaultExpanded={false}
          isStreaming={isStreaming}
          reasoningRaw={reasoning}
          theme={theme}
          toolEvents={toolEvents}
        />
      ) : null}

      {text ? (
        <RichMarkdown text={text} theme={theme} />
      ) : isStreaming ? (
        <Text style={[styles.placeholderText, { color: theme.tertiaryForeground }]}>
          {hasTimeline ? "正在整理回复…" : "正在生成…"}
        </Text>
      ) : null}

      {generatedImages.length > 0 ? (
        <View style={styles.generatedGrid}>
          {generatedImages.map((img, idx) => {
            const rawUrl = img.url || (img.base64 ? `data:${img.mime || "image/png"};base64,${img.base64}` : "");
            if (!rawUrl) return null;
            const uri = resolveImageUri(rawUrl, endpoint);
            return (
              <Pressable
                key={idx}
                onPress={() => onPreviewImage?.(uri)}
                style={[
                  styles.generatedCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Image resizeMode="cover" source={{ uri }} style={styles.generatedImg} />
                <View style={styles.generatedCaptionRow}>
                  <MaterialCommunityIcons color={theme.signalText} name="image-outline" size={14} />
                  <Text numberOfLines={1} style={[styles.generatedCaption, { color: theme.signalText }]}>
                    {img.revisedPrompt || "点击全屏预览 / 保存到相册"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {message.streamError ? (
        <View
          style={[
            styles.errorBanner,
            { backgroundColor: theme.dangerSurface, borderColor: theme.danger },
          ]}
        >
          <Text style={[styles.errorBannerText, { color: theme.danger }]}>
            {message.streamError}
          </Text>
        </View>
      ) : null}

      {!isStreaming && (text || onRetry) ? (
        <View style={styles.actionRow}>
          {text ? (
            <Pressable hitSlop={6} onPress={handleCopyAll} style={styles.actionChip}>
              <MaterialCommunityIcons
                color={copied ? theme.success : theme.tertiaryForeground}
                name={copied ? "check" : "content-copy"}
                size={14}
              />
              <Text style={[styles.actionLabel, { color: copied ? theme.success : theme.tertiaryForeground }]}>
                {copied ? "已复制" : "复制"}
              </Text>
            </Pressable>
          ) : null}
          {onReply ? (
            <Pressable
              hitSlop={6}
              onPress={() => {
                void lightTap();
                onReply(message);
              }}
              style={styles.actionChip}
            >
              <MaterialCommunityIcons color={theme.tertiaryForeground} name="reply-outline" size={14} />
              <Text style={[styles.actionLabel, { color: theme.tertiaryForeground }]}>引用</Text>
            </Pressable>
          ) : null}
          {onRetry && typeof message.id === "number" ? (
            <Pressable
              hitSlop={6}
              onPress={() => {
                void lightTap();
                onRetry(message);
              }}
              style={styles.actionChip}
            >
              <MaterialCommunityIcons color={theme.tertiaryForeground} name="refresh" size={14} />
              <Text style={[styles.actionLabel, { color: theme.tertiaryForeground }]}>重试</Text>
            </Pressable>
          ) : null}
          {text ? (
            <Pressable hitSlop={6} onPress={handleShare} style={styles.actionChip}>
              <MaterialCommunityIcons color={theme.tertiaryForeground} name="share-variant-outline" size={14} />
              <Text style={[styles.actionLabel, { color: theme.tertiaryForeground }]}>分享</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ActionMenuModal
        items={menuItems}
        onClose={() => setMenuOpen(false)}
        theme={theme}
        title="消息操作"
        visible={menuOpen}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: {
    alignItems: "flex-end",
  },
  userBubble: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "88%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    rowGap: spacing.sm,
  },
  userText: {
    fontSize: 15,
    lineHeight: 22,
  },
  thumbGrid: {
    columnGap: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 6,
  },
  userThumb: {
    borderRadius: radii.sm,
    height: 76,
    width: 76,
  },
  assistantWrap: {
    rowGap: 10,
  },
  assistantHeader: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
  },
  avatar: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  avatarLabel: {
    fontSize: 10,
    fontWeight: "800",
  },
  roleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  placeholderText: {
    fontSize: 14,
    lineHeight: 21,
  },
  generatedGrid: {
    rowGap: spacing.sm,
  },
  generatedCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  generatedImg: {
    height: 210,
    width: "100%",
  },
  generatedCaptionRow: {
    alignItems: "center",
    columnGap: 6,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  generatedCaption: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  errorBanner: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBannerText: {
    fontSize: 13,
    lineHeight: 19,
  },
  actionRow: {
    alignItems: "center",
    columnGap: 16,
    flexDirection: "row",
    paddingTop: 2,
  },
  actionChip: {
    alignItems: "center",
    columnGap: 4,
    flexDirection: "row",
    paddingVertical: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
});
