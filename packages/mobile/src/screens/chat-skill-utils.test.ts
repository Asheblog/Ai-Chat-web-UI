import { describe, expect, it } from "vitest";

import { resolveSkillBindingVersion } from "./chat-skill-utils";

describe("resolveSkillBindingVersion", () => {
  it("优先使用已绑定的会话版本", () => {
    expect(
      resolveSkillBindingVersion({
        sessionBinding: { id: 1, enabled: true, versionId: 5 },
        defaultVersion: { id: 9, version: "1.0.0" },
      }),
    ).toBe(5);
  });

  it("没有绑定时回退默认版本", () => {
    expect(
      resolveSkillBindingVersion({
        sessionBinding: null,
        defaultVersion: { id: 9, version: "1.0.0" },
      }),
    ).toBe(9);
  });

  it("没有可用版本或版本不是正整数时返回 null，调用方不得提交", () => {
    expect(
      resolveSkillBindingVersion({
        sessionBinding: null,
        defaultVersion: null,
      }),
    ).toBeNull();
    expect(
      resolveSkillBindingVersion({
        sessionBinding: { id: 1, enabled: true, versionId: 0 },
        defaultVersion: { id: 0, version: "0" },
      }),
    ).toBeNull();
  });
});
