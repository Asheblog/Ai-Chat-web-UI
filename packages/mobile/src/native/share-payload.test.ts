import { describe, expect, it, vi } from "vitest";

import {
  collectIncomingShareText,
  consumeSharedText,
  extractSharedTextFromUrl,
  isShareIntoUrl,
  takeInitialDeepLinkText,
} from "./share-payload";

describe("系统分享文本解析", () => {
  it("解析 aichat://share?text=... 并保持既有参数优先级", () => {
    expect(extractSharedTextFromUrl("aichat://share?text=%E4%BD%A0%E5%A5%BD")).toBe(
      "你好",
    );
    expect(
      extractSharedTextFromUrl("aichat://share?q=from-q&text=from-text"),
    ).toBe("from-text");
    expect(extractSharedTextFromUrl("aichat://share?q=from-q&prompt=from-prompt")).toBe(
      "from-q",
    );
    expect(extractSharedTextFromUrl("aichat://share?text=hello+world")).toBe(
      "hello world",
    );
    expect(extractSharedTextFromUrl("aichat://share?text=a%26b#fragment")).toBe(
      "a&b",
    );
    expect(extractSharedTextFromUrl("aichat://share?content=from-content")).toBe(
      "from-content",
    );
    expect(extractSharedTextFromUrl("aichat://share")).toBeNull();
    expect(extractSharedTextFromUrl(null)).toBeNull();
  });

  it("只把 expo-sharing 的触发链接当作原生载荷信号", () => {
    expect(isShareIntoUrl("aichat://expo-sharing")).toBe(true);
    expect(isShareIntoUrl("aichat://expo-sharing?x=1")).toBe(true);
    expect(isShareIntoUrl("aichat://share?text=hi")).toBe(false);
    expect(isShareIntoUrl("https://expo-sharing")).toBe(false);
    expect(isShareIntoUrl(null)).toBe(false);
  });

  it("读取文本/URL 载荷，忽略图片载荷并在有文本时清空原生数据", () => {
    const source = {
      getSharedPayloads: vi.fn(() => [
        { value: "  来自系统分享  ", shareType: "text", mimeType: "text/plain" },
        { value: "https://example.com", shareType: "url", mimeType: "text/plain" },
        { value: "content://image/1", shareType: "image", mimeType: "image/png" },
      ]),
      clearSharedPayloads: vi.fn(),
    };

    expect(consumeSharedText(source)).toBe("来自系统分享\nhttps://example.com");
    expect(source.clearSharedPayloads).toHaveBeenCalledTimes(1);
  });

  it("同一份原生载荷只消费一次，ChatScreen 重挂不会重复导入", () => {
    let pending = [
      { value: "只导入一次", shareType: "text", mimeType: "text/plain" },
    ];
    const source = {
      getSharedPayloads: () => pending,
      clearSharedPayloads: () => {
        pending = [];
      },
    };

    expect(consumeSharedText(source)).toBe("只导入一次");
    expect(consumeSharedText(source)).toBeNull();
  });

  it("初始 deep link 同一个 URL 只取一次，重挂后不再返回", () => {
    const consumed = new Set<string>();
    const url = "aichat://share?text=%E5%8F%AA%E5%AF%BC%E5%85%A5%E4%B8%80%E6%AC%A1";

    expect(takeInitialDeepLinkText(url, consumed)).toBe("只导入一次");
    expect(takeInitialDeepLinkText(url, consumed)).toBeNull();
    expect(takeInitialDeepLinkText("aichat://share?text=second", consumed)).toBe(
      "second",
    );
    expect(takeInitialDeepLinkText(null, consumed)).toBeNull();
  });

  it("图片或空载荷不消费、不清空，把机会留给下一次读取", () => {
    const clear = vi.fn();
    expect(
      collectIncomingShareText([
        { value: "content://image/1", shareType: "image", mimeType: "image/png" },
      ]),
    ).toBeNull();
    expect(
      consumeSharedText({
        getSharedPayloads: () => [],
        clearSharedPayloads: clear,
      }),
    ).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });
});
