import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { saveImageToLibrary, shareImageFile } from "../../native/media";
import { successTap } from "../../native/haptics";
import type { AppTheme } from "../../theme/tokens";
import { radii, spacing } from "../../theme/tokens";

export function ImagePreviewModal({
  visible,
  imageUri,
  onClose,
  theme,
}: {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  theme: AppTheme;
}) {
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!imageUri) {
    return null;
  }

  const handleSave = async () => {
    setBusy("save");
    setStatusMessage(null);
    const result = await saveImageToLibrary(imageUri);
    setBusy(null);
    if (result.ok) {
      await successTap();
      setStatusMessage("已保存到系统相册。");
    } else {
      setStatusMessage(result.message);
    }
  };

  const handleShare = async () => {
    setBusy("share");
    setStatusMessage(null);
    const result = await shareImageFile(imageUri);
    setBusy(null);
    if (!result.ok) {
      setStatusMessage(result.message);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.topBtn}>
            <MaterialCommunityIcons color="#FFFFFF" name="close" size={22} />
            <Text style={styles.topBtnText}>关闭</Text>
          </Pressable>
          <View style={styles.topActions}>
            <Pressable disabled={busy !== null} onPress={handleSave} style={styles.topBtn}>
              {busy === "save" ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <MaterialCommunityIcons color="#FFFFFF" name="download-outline" size={20} />
              )}
              <Text style={styles.topBtnText}>保存</Text>
            </Pressable>
            <Pressable disabled={busy !== null} onPress={handleShare} style={styles.topBtn}>
              {busy === "share" ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <MaterialCommunityIcons color="#FFFFFF" name="share-variant-outline" size={20} />
              )}
              <Text style={styles.topBtnText}>分享</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.imageStage}>
          <Image resizeMode="contain" source={{ uri: imageUri }} style={styles.fullImage} />
        </View>

        {statusMessage ? (
          <View style={[styles.toast, { backgroundColor: theme.surface }]}>
            <Text style={[styles.toastText, { color: theme.foreground }]}>{statusMessage}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(9, 11, 10, 0.96)",
    flex: 1,
    justifyContent: "space-between",
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  topActions: {
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  topBtn: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: radii.pill,
    columnGap: 6,
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  imageStage: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  fullImage: {
    height: "100%",
    width: "100%",
  },
  toast: {
    alignSelf: "center",
    borderRadius: radii.pill,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toastText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
