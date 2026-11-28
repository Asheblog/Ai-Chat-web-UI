import { describe, expect, it } from "vitest";

import { mergePendingImages } from "./chat-attachment-utils";

const image = (id: string) => ({
  id,
  uri: `file:///${id}.jpg`,
  mime: "image/jpeg",
  data: "AAAA",
});

describe("mergePendingImages", () => {
  it("按 id 去重并保留 current 的顺序", () => {
    const current = [image("new"), image("shared")];
    const restored = [image("shared"), image("old")];

    expect(mergePendingImages(current, restored).map((item) => item.id)).toEqual([
      "new",
      "shared",
      "old",
    ]);
  });

  it("超过上限时丢弃尾部，不破坏已选顺序", () => {
    const current = [image("a"), image("b"), image("c")];
    const restored = [image("d"), image("e")];

    expect(mergePendingImages(current, restored, 4).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("没有新图时原样恢复失败草稿", () => {
    const restored = [image("a"), image("b")];

    expect(mergePendingImages([], restored).map((item) => item.id)).toEqual(["a", "b"]);
  });
});
