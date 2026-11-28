import type { SkillOptionItem } from "../types/mobile";

/**
 * 会话 Skill 开关提交用的版本：已绑定的会话版本优先，否则回退默认版本。
 * 两处都没有正整数版本时返回 null，调用方不得提交（后端只接受正整数 versionId）。
 */
export function resolveSkillBindingVersion(
  skill: Pick<SkillOptionItem, "sessionBinding" | "defaultVersion">,
): number | null {
  const versionId = skill.sessionBinding?.versionId ?? skill.defaultVersion?.id;
  return typeof versionId === "number" && Number.isInteger(versionId) && versionId > 0
    ? versionId
    : null;
}
