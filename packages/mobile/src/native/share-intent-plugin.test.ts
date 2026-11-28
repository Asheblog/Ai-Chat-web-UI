import { describe, expect, it } from "vitest";

const {
  applyShareIntoSchemeResource,
  resolveShareIntoScheme,
  SHARE_INTO_SCHEME_RESOURCE,
} = require("../../plugins/with-android-share-intent");

describe("Android 分享 scheme 资源", () => {
  it("为 expo-sharing 原生监听器写入 share_into_scheme", () => {
    const result = applyShareIntoSchemeResource({ resources: {} }, "aichat");

    expect(SHARE_INTO_SCHEME_RESOURCE).toBe("share_into_scheme");
    expect(result.resources.string).toEqual([
      {
        $: { name: "share_into_scheme", translatable: "false" },
        _: "aichat",
      },
    ]);
  });

  it("重复执行只保留一条并更新 scheme", () => {
    const once = applyShareIntoSchemeResource({ resources: {} }, "aichat");
    const twice = applyShareIntoSchemeResource(once, "aichat-next");

    expect(twice.resources.string).toHaveLength(1);
    expect(twice.resources.string[0]._).toBe("aichat-next");
  });

  it("scheme 支持字符串/数组，并回退到 Android 包名", () => {
    expect(resolveShareIntoScheme({ scheme: "aichat" })).toBe("aichat");
    expect(resolveShareIntoScheme({ scheme: ["first", "second"] })).toBe("first");
    expect(
      resolveShareIntoScheme({ android: { package: "com.aichat.mobile" } }),
    ).toBe("com.aichat.mobile");
    expect(resolveShareIntoScheme({})).toBeNull();
  });

  it("没有 scheme 时保持原资源不变", () => {
    const resources = {
      resources: {
        string: [{ $: { name: "app_name" }, _: "AIChat Mobile" }],
      },
    };

    expect(applyShareIntoSchemeResource(resources, null)).toBe(resources);
  });
});
