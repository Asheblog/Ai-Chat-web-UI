import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { DEFAULT_CHAT_IMAGE_LIMITS } from "@aichat/shared/image-limits";

import type { PendingImageAttachment } from "../types/mobile";

type ImagePickResult =
  | { ok: true; images: PendingImageAttachment[] }
  | { ok: false; message: string };

type DocPickResult =
  | { ok: true; file: { uri: string; name: string; mimeType?: string } | null }
  | { ok: false; message: string };

type ActionResult = { ok: true } | { ok: false; message: string };

function mapAssetsToPending(
  assets: ImagePicker.ImagePickerAsset[],
  existingCount: number,
): ImagePickResult {
  const maxAllowed = Math.min(4, DEFAULT_CHAT_IMAGE_LIMITS.maxCount);
  const remainingSlots = maxAllowed - existingCount;
  if (remainingSlots <= 0) {
    return { ok: false, message: `单条消息最多发送 ${maxAllowed} 张图片。` };
  }

  const picked: PendingImageAttachment[] = [];
  for (const asset of assets.slice(0, remainingSlots)) {
    if (!asset.base64) continue;
    const estimatedBytes = Math.round((asset.base64.length * 3) / 4);
    if (estimatedBytes > DEFAULT_CHAT_IMAGE_LIMITS.maxMb * 1024 * 1024) {
      return {
        ok: false,
        message: `图片体积超过 ${DEFAULT_CHAT_IMAGE_LIMITS.maxMb}MB 上限，请重新选择或压缩后发送。`,
      };
    }
    picked.push({
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      uri: asset.uri,
      mime: asset.mimeType || "image/jpeg",
      data: asset.base64,
      fileName: asset.fileName ?? undefined,
      sizeBytes: asset.fileSize ?? estimatedBytes,
    });
  }

  return { ok: true, images: picked };
}

export async function takePhotoWithCamera(existingCount: number): Promise<ImagePickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, message: "需要授予相机权限才能拍照发送。" };
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) {
      return { ok: true, images: [] };
    }
    return mapAssetsToPending(result.assets, existingCount);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "无法打开相机。",
    };
  }
}

export async function pickImagesFromLibrary(existingCount: number): Promise<ImagePickResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, message: "需要授予相册访问权限才能选择图片。" };
    }
    const maxAllowed = Math.min(4, DEFAULT_CHAT_IMAGE_LIMITS.maxCount);
    const remaining = Math.max(1, maxAllowed - existingCount);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) {
      return { ok: true, images: [] };
    }
    return mapAssetsToPending(result.assets, existingCount);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "无法打开系统相册。",
    };
  }
}

export async function pickDocumentFile(): Promise<DocPickResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) {
      return { ok: true, file: null };
    }
    const asset = result.assets[0];
    return {
      ok: true,
      file: {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? undefined,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "选择文档失败。",
    };
  }
}

async function materializeImageToCache(imageUri: string): Promise<File> {
  const filename = `aichat-img-${Date.now()}.png`;
  const target = new File(Paths.cache, filename);

  if (imageUri.startsWith("data:")) {
    const commaIdx = imageUri.indexOf(",");
    const base64Data = commaIdx >= 0 ? imageUri.slice(commaIdx + 1) : imageUri;
    target.create({ overwrite: true, intermediates: true });
    target.write(base64Data, { encoding: "base64" });
    return target;
  }

  if (imageUri.startsWith("file://")) {
    return new File(imageUri);
  }

  return File.downloadFileAsync(imageUri, target, { idempotent: true });
}

export async function saveImageToLibrary(imageUri: string): Promise<ActionResult> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) {
      return { ok: false, message: "未获得保存图片到相册的权限。" };
    }
    const localFile = await materializeImageToCache(imageUri);
    await MediaLibrary.Asset.create(localFile.uri);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "保存图片失败。",
    };
  }
}

export async function shareImageFile(imageUri: string): Promise<ActionResult> {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, message: "当前设备不支持系统文件分享。" };
    }
    const localFile = await materializeImageToCache(imageUri);
    await Sharing.shareAsync(localFile.uri);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "分享图片失败。",
    };
  }
}
