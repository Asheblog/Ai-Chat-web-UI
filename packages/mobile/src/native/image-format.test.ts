import { describe, expect, it } from "vitest";

import {
  base64ByteLength,
  detectImageMimeFromBase64,
  imageExtensionForMime,
  imageMimeFromFileName,
  normalizeImageMime,
  parseImageDataUri,
  resolveImageMimeFromUri,
} from "./image-format";

describe("移动端图片格式识别", () => {
  it("从 base64 文件签名识别 ImagePicker 与服务端支持的图片格式", () => {
    expect(detectImageMimeFromBase64("/9j/4AAQSkZJRgABAQAAAQ==")).toBe("image/jpeg");
    expect(detectImageMimeFromBase64("iVBORw0KGgoAAAANSUhEUg==")).toBe("image/png");
    expect(detectImageMimeFromBase64("R0lGODlhAQABAAAAAAA=")).toBe("image/gif");
    expect(detectImageMimeFromBase64("UklGRhoAAABXRUJQVlA4IA==")).toBe("image/webp");
    expect(detectImageMimeFromBase64("Qk0AAAAAAAAAAAAA")).toBe("image/bmp");
    expect(detectImageMimeFromBase64("AAAAGGZ0eXBoZWlj")).toBe("image/heic");
    expect(detectImageMimeFromBase64("SUkqAAgAAAA=")).toBe("image/tiff");
  });

  it("空数据或无法识别的数据返回 null", () => {
    expect(detectImageMimeFromBase64("")).toBeNull();
    expect(detectImageMimeFromBase64(null)).toBeNull();
    expect(detectImageMimeFromBase64("AAAA")).toBeNull();
  });

  it("按解码后的真实字节数计算图片体积", () => {
    expect(base64ByteLength("/9j/4AAQSkZJRgABAQAAAQ==")).toBe(16);
    expect(base64ByteLength("QUJD")).toBe(3);
    expect(base64ByteLength("QUJDRA==")).toBe(4);
    expect(base64ByteLength("QUJD\nRA==")).toBe(4);
    expect(base64ByteLength("")).toBe(0);
  });

  it("规范化 MIME 并给出稳定的临时文件后缀", () => {
    expect(normalizeImageMime(" Image/PNG; charset=binary ")).toBe("image/png");
    expect(normalizeImageMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeImageMime("text/plain")).toBeNull();

    expect(imageExtensionForMime("image/jpeg")).toBe(".jpg");
    expect(imageExtensionForMime("image/png")).toBe(".png");
    expect(imageExtensionForMime("image/heic")).toBe(".heic");
    expect(imageExtensionForMime("application/octet-stream")).toBe(".jpg");
  });

  it("从文件名或 URI 推断 MIME 时忽略查询串", () => {
    expect(imageMimeFromFileName("file:///cache/photo.PNG?x=1")).toBe("image/png");
    expect(imageMimeFromFileName("https://host/chat-images/a/photo.heic")).toBe(
      "image/heic",
    );
    expect(imageMimeFromFileName("https://host/no-extension")).toBeNull();
  });

  it("保存/分享前按 data URI 实际内容决定 MIME 与临时文件后缀", () => {
    const jpegDataUri = `data:image/png;base64,${"/9j/4AAQSkZJRgABAQAAAQ=="}`;
    const parsed = parseImageDataUri(jpegDataUri);

    expect(parsed?.isBase64).toBe(true);
    expect(parsed?.mimeType).toBe("image/png");
    expect(resolveImageMimeFromUri(jpegDataUri)).toBe("image/jpeg");
    expect(imageExtensionForMime(resolveImageMimeFromUri(jpegDataUri))).toBe(".jpg");
    expect(
      imageExtensionForMime(
        resolveImageMimeFromUri("data:image/webp;base64,UklGRhoAAABXRUJQVlA4IA=="),
      ),
    ).toBe(".webp");
    expect(resolveImageMimeFromUri("file:///cache/photo.png")).toBe("image/png");
    expect(resolveImageMimeFromUri("https://host/chat-images/a/photo.png")).toBe(
      "image/png",
    );
    expect(resolveImageMimeFromUri("https://host/no-extension")).toBe("image/jpeg");
  });
});
