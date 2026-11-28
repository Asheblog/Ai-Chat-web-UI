import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { lightTap } from "../../native/haptics";
import type { AppTheme } from "../../theme/tokens";
import { radii } from "../../theme/tokens";
import type { ServerProfile } from "../../types/mobile";
import { Badge, BottomSheetModal, Button } from "../ui/UiPrimitives";

export function ServerManagerSheet({
  visible,
  profiles,
  activeProfileId,
  onSelectProfile,
  onRemoveProfile,
  onAddNewServer,
  onClose,
  theme,
}: {
  visible: boolean;
  profiles: ServerProfile[];
  activeProfileId: string | null;
  onSelectProfile: (profile: ServerProfile) => void;
  onRemoveProfile: (profileId: string) => void;
  onAddNewServer: () => void;
  onClose: () => void;
  theme: AppTheme;
}) {
  return (
    <BottomSheetModal
      onClose={onClose}
      subtitle="每个服务器独立保存登录凭证，切换时自动隔离会话"
      theme={theme}
      title="多服务器连接管理"
      visible={visible}
    >
      {profiles.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.tertiaryForeground }]}>
          尚未保存任何服务端配置。
        </Text>
      ) : (
        profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          return (
            <Pressable
              key={profile.id}
              onPress={() => {
                void lightTap();
                onSelectProfile(profile);
                onClose();
              }}
              style={[
                styles.card,
                {
                  backgroundColor: active ? theme.primarySurface : theme.background,
                  borderColor: active ? theme.primary : theme.border,
                },
              ]}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardTitleWrap}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.cardTitle,
                      { color: active ? theme.signalText : theme.foreground },
                    ]}
                  >
                    {profile.name}
                  </Text>
                  {active ? <Badge label="当前" theme={theme} tone="signal" /> : null}
                </View>
                <Pressable
                  accessibilityLabel={`删除服务器 ${profile.name}`}
                  hitSlop={8}
                  onPress={() => onRemoveProfile(profile.id)}
                >
                  <MaterialCommunityIcons
                    color={theme.tertiaryForeground}
                    name="trash-can-outline"
                    size={18}
                  />
                </Pressable>
              </View>
              <Text numberOfLines={1} style={[styles.endpoint, { color: theme.tertiaryForeground }]}>
                {profile.endpoint}
              </Text>
            </Pressable>
          );
        })
      )}

      <Button
        icon="server-plus"
        label="添加或配置新服务器"
        onPress={() => {
          onClose();
          onAddNewServer();
        }}
        theme={theme}
        variant="secondary"
      />
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    fontSize: 13,
    paddingVertical: 12,
    textAlign: "center",
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 12,
    rowGap: 4,
  },
  cardTop: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardTitleWrap: {
    alignItems: "center",
    columnGap: 8,
    flex: 1,
    flexDirection: "row",
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  endpoint: {
    fontFamily: "monospace",
    fontSize: 12,
  },
});
