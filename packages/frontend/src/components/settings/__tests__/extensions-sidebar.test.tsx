import { describe, expect, test } from "vitest"
import { settingsNav, resolveSelectTarget } from "../nav"
import { systemSettingsTree, systemSettingsCards, describeSettingsLocation } from "../system-settings-tree"

describe("工具与扩展统一侧栏", () => {
  test("所有能力都可以从设置侧栏直接进入", () => {
    const entry = systemSettingsTree.find((item) => item.key === "extensions-workspace")
    expect(entry && "children" in entry ? entry.children.map(({ key, label }) => [key, label]) : []).toEqual([
      ["extensions", "总览"], ["extensions-mcp", "MCP 服务"], ["extensions-skills", "Skill"],
      ["extensions-tools", "内置工具"], ["extensions-extra", "对话增强"],
    ])
    expect(resolveSelectTarget(settingsNav, "extensions-mcp")).toEqual({ main: "system", sub: "extensions-mcp" })
    expect(resolveSelectTarget(settingsNav, "extensions")).toEqual({ main: "system", sub: "extensions" })
  })
  test("搜索卡片定位到对应子页，卡片标识保持原值", () => {
    expect(systemSettingsCards.find((card) => card.key === "extensions:mcp-secrets")?.leafKey).toBe("extensions-mcp")
    expect(systemSettingsCards.find((card) => card.key === "extensions:skill-bindings")?.leafKey).toBe("extensions-skills")
    expect(systemSettingsCards.find((card) => card.key === "extensions:python-runtime")?.leafKey).toBe("extensions-tools")
    expect(systemSettingsCards.find((card) => card.key === "extensions:title-summary")?.leafKey).toBe("extensions-extra")
    expect(describeSettingsLocation("extensions-mcp", "extensions:mcp-secrets")).toContain("MCP 服务")
  })
})
