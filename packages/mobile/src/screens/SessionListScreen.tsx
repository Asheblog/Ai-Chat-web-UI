import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { MobileUser } from "../auth-types";
import type { ChatSession } from "../session-types";
import type { AppTheme } from "../theme";
import { spacing } from "../theme";

type SessionListScreenProps = {
  endpoint: string;
  errorMessage: string | null;
  isCreating: boolean;
  isLoading: boolean;
  isLoggingOut: boolean;
  isRefreshing: boolean;
  onCreateSession: () => void;
  onEditEndpoint: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onSelectSession: (session: ChatSession) => void;
  sessions: ChatSession[];
  theme: AppTheme;
  user: MobileUser;
};

export function SessionListScreen({
  endpoint,
  errorMessage,
  isCreating,
  isLoading,
  isLoggingOut,
  isRefreshing,
  onCreateSession,
  onEditEndpoint,
  onLogout,
  onRefresh,
  onSelectSession,
  sessions,
  theme,
  user,
}: SessionListScreenProps) {
  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={sessions}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          isLoading ? (
            <LoadingState theme={theme} />
          ) : errorMessage ? (
            <ErrorState message={errorMessage} onRetry={onRefresh} theme={theme} />
          ) : (
            <EmptyState isCreating={isCreating} onCreateSession={onCreateSession} theme={theme} />
          )
        }
        ListHeaderComponent={
          <>
            <Header
              endpoint={endpoint}
              isCreating={isCreating}
              isLoggingOut={isLoggingOut}
              onCreateSession={onCreateSession}
              onEditEndpoint={onEditEndpoint}
              onLogout={onLogout}
              theme={theme}
              user={user}
            />
            {errorMessage && sessions.length > 0 ? (
              <InlineError message={errorMessage} onRetry={onRefresh} theme={theme} />
            ) : null}
          </>
        }
        refreshControl={
          <RefreshControl
            colors={[theme.primary]}
            onRefresh={onRefresh}
            refreshing={isRefreshing}
            tintColor={theme.primary}
          />
        }
        renderItem={({ item }) => (
          <SessionRow onPress={() => onSelectSession(item)} session={item} theme={theme} />
        )}
      />
    </View>
  );
}

function Header({
  endpoint,
  isCreating,
  isLoggingOut,
  onCreateSession,
  onEditEndpoint,
  onLogout,
  theme,
  user,
}: {
  endpoint: string;
  isCreating: boolean;
  isLoggingOut: boolean;
  onCreateSession: () => void;
  onEditEndpoint: () => void;
  onLogout: () => void;
  theme: AppTheme;
  user: MobileUser;
}) {
  const initials = user.username.slice(0, 2).toUpperCase();

  return (
    <View style={styles.header}>
      <View style={styles.profileRow}>
        <View
          accessible
          accessibilityLabel={`当前用户 ${user.username}`}
          style={[styles.avatar, { backgroundColor: theme.avatarBackground, borderColor: theme.border }]}
        >
          <Text style={[styles.avatarText, { color: theme.primary }]}>{initials}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>AIChat Mobile</Text>
          <Text style={[styles.title, { color: theme.foreground }]}>会话</Text>
          <Text numberOfLines={1} style={[styles.description, { color: theme.mutedForeground }]}>
            {user.username} · {user.status} / {user.role}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="新建会话"
        accessibilityState={{ disabled: isCreating, busy: isCreating }}
        disabled={isCreating}
        onPress={onCreateSession}
        testID="create-session-button"
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: isCreating ? theme.border : pressed ? theme.primaryPressed : theme.primary,
          },
        ]}
      >
        {isCreating ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <MaterialCommunityIcons name="plus" size={22} color="#FFFFFF" />
        )}
        <Text style={styles.primaryButtonText}>{isCreating ? "正在创建" : "新建会话"}</Text>
      </Pressable>

      <View style={[styles.endpointBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <MaterialCommunityIcons name="server-network" size={22} color={theme.primary} />
        <View style={styles.endpointCopy}>
          <Text style={[styles.endpointLabel, { color: theme.mutedForeground }]}>服务端</Text>
          <Text numberOfLines={2} style={[styles.endpointValue, { color: theme.foreground }]}>
            {endpoint}
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <SecondaryButton
          icon="pencil-outline"
          label="修改服务端"
          onPress={onEditEndpoint}
          theme={theme}
        />
        <SecondaryButton
          disabled={isLoggingOut}
          icon={isLoggingOut ? "loading" : "logout"}
          label={isLoggingOut ? "正在退出" : "退出登录"}
          onPress={onLogout}
          theme={theme}
          tone="danger"
        />
      </View>
    </View>
  );
}

function SecondaryButton({
  disabled = false,
  icon,
  label,
  onPress,
  theme,
  tone = "primary",
}: {
  disabled?: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  theme: AppTheme;
  tone?: "primary" | "danger";
}) {
  const color = tone === "danger" ? theme.danger : theme.primary;
  const pressedSurface = tone === "danger" ? theme.dangerSurface : theme.primarySurface;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        {
          backgroundColor: pressed ? pressedSurface : "transparent",
          borderColor: tone === "danger" ? theme.danger : theme.border,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      {icon === "loading" ? (
        <ActivityIndicator color={color} />
      ) : (
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      )}
      <Text style={[styles.secondaryButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function SessionRow({
  onPress,
  session,
  theme,
}: {
  onPress: () => void;
  session: ChatSession;
  theme: AppTheme;
}) {
  const title = getSessionTitle(session);
  const messageCount = session._count?.messages ?? 0;
  const subtitle = session.lastMessagePreview?.trim() || "还没有消息";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开会话 ${title}`}
      onPress={onPress}
      testID={`session-row-${session.id}`}
      style={({ pressed }) => [
        styles.sessionRow,
        {
          backgroundColor: pressed ? theme.primarySurface : theme.surface,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={[styles.sessionIcon, { backgroundColor: theme.primarySurface, borderColor: theme.border }]}>
        <MaterialCommunityIcons name={session.pinnedAt ? "pin-outline" : "message-outline"} size={22} color={theme.primary} />
      </View>
      <View style={styles.sessionCopy}>
        <View style={styles.sessionTitleRow}>
          <Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.foreground }]}>
            {title}
          </Text>
          <Text style={[styles.sessionMeta, { color: theme.mutedForeground }]}>
            {formatRelativeTime(session.lastMessageAt ?? session.createdAt)}
          </Text>
        </View>
        <Text numberOfLines={2} style={[styles.sessionPreview, { color: theme.mutedForeground }]}>
          {subtitle}
        </Text>
        <Text numberOfLines={1} style={[styles.sessionModel, { color: theme.mutedForeground }]}>
          {session.modelLabel ?? session.modelRawId ?? "未显示模型"} · {messageCount} 条消息
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={22}
        color={theme.mutedForeground}
      />
    </Pressable>
  );
}

function LoadingState({ theme }: { theme: AppTheme }) {
  return (
    <View style={[styles.stateBox, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.primary} />
      <Text style={[styles.stateTitle, { color: theme.foreground }]}>正在加载会话</Text>
      <Text style={[styles.stateBody, { color: theme.mutedForeground }]}>会使用当前登录令牌读取你可访问的会话。</Text>
    </View>
  );
}

function ErrorState({
  message,
  onRetry,
  theme,
}: {
  message: string;
  onRetry: () => void;
  theme: AppTheme;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.stateBox, { backgroundColor: theme.dangerSurface, borderColor: theme.danger }]}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={28} color={theme.danger} />
      <Text style={[styles.stateTitle, { color: theme.danger }]}>会话加载失败</Text>
      <Text style={[styles.stateBody, { color: theme.danger }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="重试加载会话"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryButton,
          { backgroundColor: pressed ? theme.primaryPressed : theme.primary },
        ]}
      >
        <MaterialCommunityIcons name="reload" size={20} color="#FFFFFF" />
        <Text style={styles.primaryButtonText}>重试</Text>
      </Pressable>
    </View>
  );
}

function InlineError({
  message,
  onRetry,
  theme,
}: {
  message: string;
  onRetry: () => void;
  theme: AppTheme;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.inlineError, { backgroundColor: theme.dangerSurface, borderColor: theme.danger }]}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={22} color={theme.danger} />
      <Text style={[styles.inlineErrorText, { color: theme.danger }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="重试加载会话"
        hitSlop={8}
        onPress={onRetry}
        style={({ pressed }) => [
          styles.inlineErrorButton,
          { backgroundColor: pressed ? theme.primarySurface : "transparent" },
        ]}
      >
        <MaterialCommunityIcons name="reload" size={20} color={theme.primary} />
      </Pressable>
    </View>
  );
}

function EmptyState({
  isCreating,
  onCreateSession,
  theme,
}: {
  isCreating: boolean;
  onCreateSession: () => void;
  theme: AppTheme;
}) {
  return (
    <View style={[styles.stateBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <MaterialCommunityIcons name="message-plus-outline" size={32} color={theme.primary} />
      <Text style={[styles.stateTitle, { color: theme.foreground }]}>还没有会话</Text>
      <Text style={[styles.stateBody, { color: theme.mutedForeground }]}>创建一个空会话后，就可以进入聊天页发送消息。</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="创建第一个会话"
        accessibilityState={{ disabled: isCreating, busy: isCreating }}
        disabled={isCreating}
        onPress={onCreateSession}
        style={({ pressed }) => [
          styles.retryButton,
          { backgroundColor: isCreating ? theme.border : pressed ? theme.primaryPressed : theme.primary },
        ]}
      >
        {isCreating ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
        )}
        <Text style={styles.primaryButtonText}>{isCreating ? "正在创建" : "创建会话"}</Text>
      </Pressable>
    </View>
  );
}

function getSessionTitle(session: ChatSession) {
  const title = session.title?.trim();
  return title || `会话 ${session.id}`;
}

function formatRelativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} 天前`;
  }

  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    rowGap: spacing.md,
  },
  header: {
    paddingBottom: spacing.md,
    rowGap: spacing.lg,
  },
  profileRow: {
    alignItems: "center",
    columnGap: spacing.md,
    flexDirection: "row",
  },
  avatar: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "800",
  },
  profileCopy: {
    flex: 1,
    rowGap: 2,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  endpointBox: {
    alignItems: "flex-start",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    padding: spacing.lg,
  },
  endpointCopy: {
    flex: 1,
    rowGap: 4,
  },
  endpointLabel: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  endpointValue: {
    fontSize: 15,
    lineHeight: 22,
  },
  actionRow: {
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  sessionRow: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.md,
    flexDirection: "row",
    minHeight: 96,
    padding: spacing.lg,
  },
  sessionIcon: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sessionCopy: {
    flex: 1,
    rowGap: 4,
  },
  sessionTitleRow: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  sessionTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 24,
  },
  sessionMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  sessionPreview: {
    fontSize: 14,
    lineHeight: 20,
  },
  sessionModel: {
    fontSize: 12,
    lineHeight: 18,
  },
  inlineError: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  inlineErrorButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  stateBox: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    padding: spacing.xl,
    rowGap: spacing.md,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    textAlign: "center",
  },
  stateBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  retryButton: {
    alignItems: "center",
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 48,
    minWidth: 140,
    paddingHorizontal: spacing.lg,
  },
});
