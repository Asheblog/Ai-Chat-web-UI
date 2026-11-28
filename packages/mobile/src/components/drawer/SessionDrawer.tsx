import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { MobileUser } from "../../auth-types";
import { lightTap } from "../../native/haptics";
import type { ChatSession } from "../../session-types";
import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";
import type { ServerProfile } from "../../types/mobile";
import { ActionMenuModal, Button, type ActionMenuItem } from "../ui/UiPrimitives";

type SessionDrawerContentProps = {
  theme: AppTheme;
  sessions: ChatSession[];
  activeSessionId: number | null;
  activeServer: ServerProfile | null;
  user: MobileUser;
  /** 会话操作（置顶 / 删除 / 清空）失败等工作区级错误；抽屉覆盖主区域时仍要可见。 */
  errorMessage?: string | null;
  onDismissError?: () => void;
  /** 加载类错误的重试入口；有活动对话时不传，避免重载工作区把聊天流卸载。 */
  onRetryError?: () => void;
  /** 会话列表下拉刷新；只刷新列表，不应卸载进行中的聊天。 */
  isRefreshingSessions?: boolean;
  onRefreshSessions?: () => void;
  onSelectSession: (session: ChatSession) => void;
  onNewChat: () => void;
  onTogglePin: (session: ChatSession) => void;
  onRenameSession: (session: ChatSession, newTitle: string) => Promise<void>;
  onClearMessages: (session: ChatSession) => void;
  onDeleteSession: (session: ChatSession) => void;
  onOpenSettings: () => void;
  onOpenServers: () => void;
  onClose?: () => void;
};

export function SessionDrawerContent({
  theme,
  sessions,
  activeSessionId,
  activeServer,
  user,
  errorMessage = null,
  onDismissError,
  onRetryError,
  isRefreshingSessions = false,
  onRefreshSessions,
  onSelectSession,
  onNewChat,
  onTogglePin,
  onRenameSession,
  onClearMessages,
  onDeleteSession,
  onOpenSettings,
  onOpenServers,
  onClose,
}: SessionDrawerContentProps) {
  const [search, setSearch] = useState("");
  const [actionTarget, setActionTarget] = useState<ChatSession | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const { pinned, recent } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? sessions.filter((s) =>
          `${s.title} ${s.modelLabel ?? ""} ${s.lastMessagePreview ?? ""}`
            .toLowerCase()
            .includes(query),
        )
      : sessions;

    return {
      pinned: filtered.filter((s) => Boolean(s.pinnedAt)),
      recent: filtered.filter((s) => !s.pinnedAt),
    };
  }, [search, sessions]);

  const menuItems: ActionMenuItem[] = actionTarget
    ? [
        {
          id: "pin",
          label: actionTarget.pinnedAt ? "取消置顶" : "置顶会话",
          icon: actionTarget.pinnedAt ? "pin-off-outline" : "pin-outline",
          onPress: () => onTogglePin(actionTarget),
        },
        {
          id: "rename",
          label: "重命名会话",
          icon: "pencil-outline",
          onPress: () => {
            setRenameError(null);
            setRenameTarget(actionTarget);
            setRenameText(actionTarget.title || "");
          },
        },
        {
          id: "clear",
          label: "清空历史消息",
          icon: "broom",
          onPress: () => onClearMessages(actionTarget),
        },
        {
          id: "delete",
          label: "删除会话",
          icon: "trash-can-outline",
          destructive: true,
          onPress: () => onDeleteSession(actionTarget),
        },
      ]
    : [];

  const closeRename = () => {
    setRenameTarget(null);
    setRenameError(null);
  };

  const handleConfirmRename = async () => {
    if (!renameTarget) return;
    const trimmed = renameText.trim();
    if (!trimmed) return;
    setRenameError(null);
    setIsRenaming(true);
    try {
      await onRenameSession(renameTarget, trimmed);
      setRenameTarget(null);
    } catch (error) {
      // 保存失败时保留弹窗并就地展示错误，不能让失败看起来像成功。
      setRenameError(
        error instanceof Error && error.message ? error.message : "重命名失败，请重试。",
      );
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderRightColor: theme.border }]}>
      <View style={styles.topSection}>
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <View style={[styles.brandDot, { backgroundColor: theme.primary }]} />
            <Text style={[styles.brandName, { color: theme.foreground }]}>
              {activeServer?.brandText || "AIChat"}
            </Text>
          </View>
          {onClose ? (
            <Pressable
              accessibilityLabel="关闭会话列表"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
            >
              <MaterialCommunityIcons color={theme.tertiaryForeground} name="close" size={20} />
            </Pressable>
          ) : null}
        </View>

        <View
          style={[
            styles.searchBox,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons color={theme.tertiaryForeground} name="magnify" size={18} />
          <TextInput
            onChangeText={setSearch}
            placeholder="搜索会话标题…"
            placeholderTextColor={theme.tertiaryForeground}
            style={[styles.searchInput, { color: theme.foreground }]}
            value={search}
          />
          {search.length > 0 ? (
            <Pressable hitSlop={6} onPress={() => setSearch("")}>
              <MaterialCommunityIcons color={theme.tertiaryForeground} name="close-circle" size={16} />
            </Pressable>
          ) : null}
        </View>

        <Button
          icon="plus"
          label="新建对话"
          onPress={() => {
            void lightTap();
            onNewChat();
          }}
          theme={theme}
        />
      </View>

      {errorMessage ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.errorBanner,
            {
              backgroundColor: theme.dangerSurface,
              borderTopColor: theme.danger,
              borderBottomColor: theme.danger,
            },
          ]}
        >
          <MaterialCommunityIcons
            color={theme.danger}
            name="alert-circle-outline"
            size={16}
          />
          <Text numberOfLines={3} style={[styles.errorBannerText, { color: theme.danger }]}>
            {errorMessage}
          </Text>
          {onRetryError ? (
            <Pressable
              accessibilityLabel="重新加载工作区"
              accessibilityRole="button"
              onPress={onRetryError}
              style={styles.bannerAction}
            >
              <MaterialCommunityIcons color={theme.danger} name="reload" size={16} />
            </Pressable>
          ) : null}
          {onDismissError ? (
            <Pressable
              accessibilityLabel="关闭错误提示"
              accessibilityRole="button"
              onPress={onDismissError}
              style={styles.bannerAction}
            >
              <MaterialCommunityIcons color={theme.danger} name="close" size={16} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={[styles.listContent, styles.listContentGrow]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefreshSessions ? (
            <RefreshControl
              colors={[theme.primary]}
              onRefresh={onRefreshSessions}
              refreshing={isRefreshingSessions}
              tintColor={theme.primary}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      >
        {pinned.length > 0 ? (
          <View style={styles.group}>
            <Text style={[styles.groupTitle, { color: theme.tertiaryForeground }]}>
              置顶会话
            </Text>
            {pinned.map((s) => (
              <DrawerRow
                key={s.id}
                active={s.id === activeSessionId}
                onMore={() => setActionTarget(s)}
                onPress={() => onSelectSession(s)}
                session={s}
                theme={theme}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={[styles.groupTitle, { color: theme.tertiaryForeground }]}>
            最近对话 ({recent.length})
          </Text>
          {recent.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.tertiaryForeground }]}>
              {search ? "未找到匹配的会话" : "暂无会话，点击上方按钮开始"}
            </Text>
          ) : (
            recent.map((s) => (
              <DrawerRow
                key={s.id}
                active={s.id === activeSessionId}
                onMore={() => setActionTarget(s)}
                onPress={() => onSelectSession(s)}
                session={s}
                theme={theme}
              />
            ))
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={onOpenServers}
          style={[styles.serverPill, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
        >
          <View style={[styles.onlineDot, { backgroundColor: theme.success }]} />
          <Text numberOfLines={1} style={[styles.serverName, { color: theme.mutedForeground }]}>
            {activeServer?.name || activeServer?.endpoint || "未选择服务端"}
          </Text>
          <MaterialCommunityIcons color={theme.signalText} name="swap-horizontal" size={16} />
        </Pressable>

        <View style={styles.userRow}>
          <View style={styles.userLeft}>
            <View style={[styles.userAvatar, { backgroundColor: theme.primarySurface }]}>
              <Text style={[styles.userAvatarText, { color: theme.signalText }]}>
                {(user.username || "U").slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.userMeta}>
              <Text numberOfLines={1} style={[styles.userName, { color: theme.foreground }]}>
                {user.username}
              </Text>
              <Text style={[styles.userRole, { color: theme.tertiaryForeground }]}>
                {user.role === "ADMIN" ? "管理员" : "成员"}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="打开设置"
            onPress={() => {
              void lightTap();
              onOpenSettings();
            }}
            style={[styles.settingsBtn, { backgroundColor: theme.surfaceSubtle }]}
          >
            <MaterialCommunityIcons color={theme.signalText} name="cog-outline" size={20} />
          </Pressable>
        </View>
      </View>

      <ActionMenuModal
        items={menuItems}
        onClose={() => setActionTarget(null)}
        theme={theme}
        title={actionTarget?.title || "会话操作"}
        visible={Boolean(actionTarget)}
      />

      <Modal
        animationType="fade"
        onRequestClose={closeRename}
        transparent
        visible={Boolean(renameTarget)}
      >
        <View style={[styles.renameOverlay, { backgroundColor: theme.scrim }]}>
          <View style={[styles.renameCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.renameTitle, { color: theme.foreground }]}>重命名会话</Text>
            <TextInput
              autoFocus
              onChangeText={setRenameText}
              placeholder="输入新的会话标题"
              placeholderTextColor={theme.tertiaryForeground}
              style={[
                styles.renameInput,
                { backgroundColor: theme.background, borderColor: theme.borderStrong, color: theme.foreground },
              ]}
              value={renameText}
            />
            {renameError ? (
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                style={[styles.renameError, { color: theme.danger }]}
              >
                {renameError}
              </Text>
            ) : null}
            <View style={styles.renameActions}>
              <Button
                label="取消"
                onPress={closeRename}
                style={styles.renameBtn}
                theme={theme}
                variant="secondary"
              />
              <Button
                disabled={!renameText.trim() || isRenaming}
                label="保存"
                loading={isRenaming}
                onPress={handleConfirmRename}
                style={styles.renameBtn}
                theme={theme}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DrawerRow({
  session,
  active,
  theme,
  onPress,
  onMore,
}: {
  session: ChatSession;
  active: boolean;
  theme: AppTheme;
  onPress: () => void;
  onMore: () => void;
}) {
  return (
    <Pressable
      onLongPress={() => {
        void lightTap();
        onMore();
      }}
      onPress={() => {
        void lightTap();
        onPress();
      }}
      style={[
        styles.row,
        {
          backgroundColor: active ? theme.primarySurface : "transparent",
          borderColor: active ? theme.primary : "transparent",
        },
      ]}
    >
      <View style={styles.rowTextCol}>
        <View style={styles.rowTitleLine}>
          {session.pinnedAt ? (
            <MaterialCommunityIcons color={theme.signalText} name="pin" size={13} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.rowTitle,
              {
                color: active ? theme.signalText : theme.foreground,
                fontWeight: active ? "700" : "500",
              },
            ]}
          >
            {session.title?.trim() || "未命名对话"}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.rowSub, { color: theme.tertiaryForeground }]}>
          {session.modelLabel || session.modelRawId || "默认模型"}
          {session._count?.messages ? ` · ${session._count.messages} 条` : ""}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`${session.title?.trim() || "未命名对话"} 的会话操作`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMore}
        style={styles.moreBtn}
      >
        <MaterialCommunityIcons color={theme.tertiaryForeground} name="dots-horizontal" size={18} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 1,
  },
  topSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    rowGap: spacing.md,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brandLeft: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
  },
  brandDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  brandName: {
    fontSize: 17,
    fontWeight: "800",
  },
  searchBox: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 6,
  },
  errorBanner: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 4,
  },
  bannerAction: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    rowGap: spacing.lg,
  },
  /** 列表不足一屏时也能触发下拉刷新（空列表 / 少量会话）。 */
  listContentGrow: {
    flexGrow: 1,
  },
  group: {
    rowGap: 4,
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  row: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  rowTextCol: {
    flex: 1,
    rowGap: 2,
  },
  rowTitleLine: {
    alignItems: "center",
    columnGap: 4,
    flexDirection: "row",
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
  },
  rowSub: {
    fontSize: 11,
  },
  moreBtn: {
    padding: 4,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    rowGap: 10,
  },
  serverPill: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  onlineDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  serverName: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
  },
  userRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  userLeft: {
    alignItems: "center",
    columnGap: 10,
    flex: 1,
    flexDirection: "row",
  },
  userAvatar: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: "700",
  },
  userMeta: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: "700",
  },
  userRole: {
    fontSize: 11,
  },
  settingsBtn: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  renameOverlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  renameCard: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 360,
    padding: spacing.lg,
    rowGap: spacing.md,
    width: "100%",
  },
  renameTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  renameInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  renameError: {
    fontSize: 12,
    lineHeight: 18,
  },
  renameActions: {
    columnGap: 10,
    flexDirection: "row",
  },
  renameBtn: {
    flex: 1,
  },
});
