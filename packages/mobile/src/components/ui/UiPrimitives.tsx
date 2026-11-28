import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";

type ButtonVariant = "primary" | "secondary" | "soft" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  theme,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  theme: AppTheme;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = getButtonPalette(variant, theme);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? palette.pressedBg : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.border === "transparent" ? 0 : 1,
          opacity: disabled ? 0.52 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : icon ? (
        <MaterialCommunityIcons color={palette.fg} name={icon} size={18} />
      ) : null}
      <Text style={[styles.buttonText, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

function getButtonPalette(variant: ButtonVariant, theme: AppTheme) {
  switch (variant) {
    case "primary":
      return {
        bg: theme.primary,
        pressedBg: theme.primaryPressed,
        fg: theme.primaryForeground,
        border: "transparent",
      };
    case "soft":
      return {
        bg: theme.primarySurface,
        pressedBg: theme.surfaceHover,
        fg: theme.signalText,
        border: "transparent",
      };
    case "danger":
      return {
        bg: theme.dangerSurface,
        pressedBg: theme.surfaceHover,
        fg: theme.danger,
        border: theme.danger,
      };
    case "ghost":
      return {
        bg: "transparent",
        pressedBg: theme.surfaceSubtle,
        fg: theme.mutedForeground,
        border: "transparent",
      };
    default:
      return {
        bg: theme.surface,
        pressedBg: theme.surfaceSubtle,
        fg: theme.foreground,
        border: theme.borderStrong,
      };
  }
}

export function IconButton({
  icon,
  label,
  onPress,
  theme,
  color,
  backgroundColor,
  size = 20,
  disabled = false,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  theme: AppTheme;
  color?: string;
  backgroundColor?: string;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor:
            backgroundColor ?? (pressed ? theme.surfaceHover : theme.surfaceSubtle),
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <MaterialCommunityIcons
        color={color ?? theme.foreground}
        name={icon}
        size={size}
      />
    </Pressable>
  );
}

export function SurfaceCard({
  children,
  theme,
  subtle = false,
  style,
}: {
  children: ReactNode;
  theme: AppTheme;
  subtle?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: subtle ? theme.surfaceSubtle : theme.surface,
          borderColor: theme.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Badge({
  label,
  theme,
  tone = "neutral",
}: {
  label: string;
  theme: AppTheme;
  tone?: "neutral" | "signal" | "success" | "danger" | "warning";
}) {
  const toneStyle =
    tone === "signal"
      ? { bg: theme.primarySurface, fg: theme.signalText }
      : tone === "success"
        ? { bg: theme.successSurface, fg: theme.success }
        : tone === "danger"
          ? { bg: theme.dangerSurface, fg: theme.danger }
          : tone === "warning"
            ? { bg: theme.warningSurface, fg: theme.warning }
            : { bg: theme.surfaceSubtle, fg: theme.mutedForeground };

  return (
    <View style={[styles.badge, { backgroundColor: toneStyle.bg }]}>
      <Text style={[styles.badgeText, { color: toneStyle.fg }]}>{label}</Text>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  theme: AppTheme;
}) {
  return (
    <View
      style={[
        styles.segmented,
        { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segmentedItem,
              active
                ? {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    borderWidth: StyleSheet.hairlineWidth,
                  }
                : null,
            ]}
          >
            <Text
              style={[
                styles.segmentedText,
                {
                  color: active ? theme.foreground : theme.mutedForeground,
                  fontWeight: active ? "700" : "500",
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 开关行的可访问契约：整行作为一个 switch 暴露，标题是可读名称、说明是提示，
 * 状态同时给出 checked 与 disabled，读屏用户不必再靠视觉判断开关是否开启。
 */
export function buildSwitchRowAccessibility({
  title,
  subtitle,
  value,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  disabled?: boolean;
}) {
  return {
    accessibilityRole: "switch" as const,
    accessibilityLabel: title,
    accessibilityHint: subtitle,
    accessibilityState: { checked: value, disabled },
  };
}

export function SwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
  theme,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  theme: AppTheme;
  disabled?: boolean;
}) {
  return (
    <Pressable
      {...buildSwitchRowAccessibility({ title, subtitle, value, disabled })}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.switchRow,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.switchTextWrap}>
        <Text style={[styles.switchTitle, { color: theme.foreground }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.switchSub, { color: theme.tertiaryForeground }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityElementsHidden
        accessible={false}
        disabled={disabled}
        importantForAccessibility="no-hide-descendants"
        onValueChange={onValueChange}
        pointerEvents="none"
        thumbColor={theme.surface}
        trackColor={{ false: theme.borderStrong, true: theme.primary }}
        value={value}
      />
    </Pressable>
  );
}

export function BottomSheetModal({
  visible,
  title,
  subtitle,
  onClose,
  theme,
  children,
  headerRight,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  theme: AppTheme;
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={[styles.sheetOverlay, { backgroundColor: theme.scrim }]}>
        <Pressable onPress={onClose} style={styles.sheetBackdrop} />
        <View
          style={[
            styles.sheetContainer,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
            <View style={styles.sheetHeaderText}>
              <Text style={[styles.sheetTitle, { color: theme.foreground }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.sheetSubtitle, { color: theme.tertiaryForeground }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.sheetHeaderActions}>
              {headerRight}
              <IconButton icon="close" label="关闭面板" onPress={onClose} theme={theme} size={18} />
            </View>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export type ActionMenuItem = {
  id: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
};

export function ActionMenuModal({
  visible,
  title,
  items,
  onClose,
  theme,
}: {
  visible: boolean;
  title?: string;
  items: ActionMenuItem[];
  onClose: () => void;
  theme: AppTheme;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={[styles.menuOverlay, { backgroundColor: theme.scrim }]}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          style={[
            styles.menuCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {title ? (
            <Text style={[styles.menuTitle, { color: theme.tertiaryForeground }]}>
              {title}
            </Text>
          ) : null}
          {items.map((item, idx) => (
            <Pressable
              key={item.id}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={({ pressed }) => [
                styles.menuItem,
                idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null,
                pressed ? { backgroundColor: theme.surfaceSubtle } : null,
              ]}
            >
              <MaterialCommunityIcons
                color={item.destructive ? theme.danger : theme.foreground}
                name={item.icon}
                size={20}
              />
              <Text
                style={[
                  styles.menuItemText,
                  { color: item.destructive ? theme.danger : theme.foreground },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  segmented: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 4,
    flexDirection: "row",
    padding: 4,
  },
  segmentedItem: {
    alignItems: "center",
    borderRadius: 9,
    flex: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 8,
  },
  segmentedText: {
    fontSize: 13,
  },
  switchRow: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchTextWrap: {
    flex: 1,
    rowGap: 2,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  switchSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetContainer: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "84%",
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: "center",
    borderRadius: radii.pill,
    height: 4,
    marginTop: 10,
    width: 40,
  },
  sheetHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetHeaderText: {
    flex: 1,
    rowGap: 2,
  },
  sheetHeaderActions: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  sheetSubtitle: {
    fontSize: 12,
  },
  sheetScrollContent: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  menuOverlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  menuCard: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 340,
    overflow: "hidden",
    width: "100%",
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  menuItem: {
    alignItems: "center",
    columnGap: spacing.md,
    flexDirection: "row",
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
