import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

import {
  imageLimitMessage,
  remainingImageSlots,
  toPendingImageAttachments,
  type ExistingImageState,
  type ImagePickResult,
} from "./image-attachment";
import {
  imageExtensionForMime,
  parseImageDataUri,
  resolveImageMimeFromUri,
} from "./image-format";

type DocPickResult =
  | { ok: true; file: { uri: string; name: string; mimeType?: string } | null }
  | { ok: false; message: string };

type ActionResult = { ok: true } | { ok: false; message: string };

type MaterializedImage = { file: File; mimeType: string };

export async function takePhotoWithCamera(
  existing: ExistingImageState = [],
): Promise<ImagePickResult> {
  if (remainingImageSlots(existing) <= 0) {
    return { ok: false, message: imageLimitMessage() };
  }

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
    return toPendingImageAttachments(result.assets, existing);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "无法打开相机。",
    };
  }
}

export async function pickImagesFromLibrary(
  existing: ExistingImageState = [],
): Promise<ImagePickResult> {
  const remaining = remainingImageSlots(existing);
  if (remaining <= 0) {
    return { ok: false, message: imageLimitMessage() };
  }

  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, message: "需要授予相册访问权限才能选择图片。" };
    }

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
    return toPendingImageAttachments(result.assets, existing);
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

function createCacheImageFile(extension: string): File {
  const suffix = Math.random().toString(36).slice(2, 8);
  return new File(Paths.cache, `aichat-img-${Date.now()}-${suffix}${extension}`);
}

/**
 * 把 data URI / file URI / http(s) URL 落成带正确后缀的本地文件，供保存相册与系统分享使用。
 * 旧实现固定写 .png，而生成图片或 AI 图片经常是 JPEG/WebP，后缀与 MIME 会不一致。
 */
async function materializeImageToCache(imageUri: string): Promise<MaterializedImage> {
  const parsed = parseImageDataUri(imageUri);
  if (parsed) {
    const mimeType = resolveImageMimeFromUri(imageUri);
    const target = createCacheImageFile(imageExtensionForMime(mimeType));
    target.create({ overwrite: true, intermediates: true });

    if (parsed.isBase64) {
      const data = parsed.data.replace(/\s+/g, "");
      if (!data) {
        throw new Error("图片数据为空。");
      }
      target.write(data, { encoding: "base64" });
    } else {
      try {
        target.write(decodeURIComponent(parsed.data), { encoding: "utf8" });
      } catch {
        throw new Error("图片数据格式不受支持。");
      }
    }

    return { file: target, mimeType };
  }

  if (imageUri.startsWith("file://")) {
    return {
      file: new File(imageUri),
      mimeType: resolveImageMimeFromUri(imageUri),
    };
  }

  const mimeType = resolveImageMimeFromUri(imageUri);
  const target = createCacheImageFile(imageExtensionForMime(mimeType));
  const file = await File.downloadFileAsync(imageUri, target, { idempotent: true });
  return { file, mimeType };
}

export async function saveImageToLibrary(imageUri: string): Promise<ActionResult> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) {
      return { ok: false, message: "未获得保存图片到相册的权限。" };
    }
    const { file } = await materializeImageToCache(imageUri);
    await MediaLibrary.Asset.create(file.uri);
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
    const { file, mimeType } = await materializeImageToCache(imageUri);
    await Sharing.shareAsync(file.uri, { mimeType });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "分享图片失败。",
    };
  }
}
