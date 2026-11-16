import { describe, expect, test } from "vitest"
import {
  describeSettingsLocation,
  getAllSystemLeafKeys,
  systemSettingsCards,
} from "../system-settings-registry"

/** 「能力扩展」页的 13 张卡，按页内段顺序（叶子 key 与导航树保持 extensions）。 */
const EXTENSION_CARD_KEYS = [
  "extensions:mcp-installations",
  "extensions:mcp-connections",
  "extensions:mcp-secrets",
  "extensions:mcp-tools",
  "extensions:mcp-bindings",
  "extensions:skill-install",
  "extensions:skill-approvals",
  "extensions:skill-versions",
  "extensions:skill-bindings",
  "extensions:python-tools",
  "extensions:python-runtime",
  "extensions:battle",
  "extensions:title-summary",
]

/** 期望的卡清单快照：leafKey -> 卡 key 列表（防止注册表误删/漂移） */
const EXPECTED_CARDS: Record<string, string[]> = {
  connections: ["quick-connect", "advanced"],
  models: ["catalog", "access"],
  "session-defaults": ["prompt"],
  "search-knowledge": ["web-search", "document-knowledge"],
  extensions: EXTENSION_CARD_KEYS.map((key) => key.slice("extensions:".length)),
  "users-registration": ["policy", "users"],
  branding: ["avatar", "branding"],
  "data-maintenance": ["retention", "compression", "concurrency", "task-trace", "system-log"],
  "reasoning-network": ["reasoning", "stream", "network"],
}

describe("system-settings-card-registry", () => {
  test("extensions 卡恰好 13 条且 key 顺序与集合正确", () => {
    const extensionCards = systemSettingsCards.filter((card) => card.leafKey === "extensions")
    expect(extensionCards).toHaveLength(13)
    expect(extensionCards.map((card) => card.key)).toEqual(EXTENSION_CARD_KEYS)
  })

  test("不再存在 tools-extensions:* / skills-governance:* 卡", () => {
    const legacy = systemSettingsCards.filter(
      (card) => card.key.startsWith("tools-extensions:") || card.key.startsWith("skills-governance:"),
    )
    expect(legacy).toEqual([])
    expect(systemSettingsCards.some((card) => card.leafKey === "tools-extensions")).toBe(false)
    expect(systemSettingsCards.some((card) => card.leafKey === "skills-governance")).toBe(false)
  })

  test("每个卡的 leafKey 都指向导航树中存在的叶子", () => {
    const leafKeys = new Set(getAllSystemLeafKeys())
    for (const card of systemSettingsCards) {
      expect(leafKeys.has(card.leafKey), `卡 ${card.key} 的 leafKey ${card.leafKey} 不在导航树中`).toBe(true)
    }
  })

  test("卡 key 全局唯一，且以 leafKey 为前缀（leafKey:cardKey）", () => {
    const keys = systemSettingsCards.map((card) => card.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const card of systemSettingsCards) {
      expect(card.key.startsWith(`${card.leafKey}:`)).toBe(true)
    }
  })

  test("卡 label 非空，keywords 可选但非空串", () => {
    for (const card of systemSettingsCards) {
      expect(card.label.trim().length).toBeGreaterThan(0)
      for (const keyword of card.keywords ?? []) {
        expect(keyword.trim().length).toBeGreaterThan(0)
      }
    }
  })

  test("卡清单与期望快照完全一致（无缺漏、无多余）", () => {
    const byLeaf = new Map<string, string[]>()
    for (const card of systemSettingsCards) {
      const list = byLeaf.get(card.leafKey) ?? []
      // 快照用短 key（去掉 "leafKey:" 前缀）比对
      list.push(card.key.slice(card.leafKey.length + 1))
      byLeaf.set(card.leafKey, list)
    }
    expect(Object.fromEntries(byLeaf)).toEqual(EXPECTED_CARDS)
  })

  test("describeSettingsLocation：拍平的 extensions 无分组前缀", () => {
    expect(describeSettingsLocation("extensions", "extensions:mcp-secrets")).toBe("工具与扩展 · MCP 凭据")
    expect(describeSettingsLocation("extensions", "extensions:python-tools")).toBe("工具与扩展 · Python 工具")
  })

  test("describeSettingsLocation：拍平后的 users-registration / branding 无分组前缀", () => {
    expect(describeSettingsLocation("users-registration")).toBe("用户与访问")
    expect(describeSettingsLocation("users-registration", "users-registration:policy")).toBe(
      "用户与访问 · 用户注册",
    )
    expect(describeSettingsLocation("branding", "branding:branding")).toBe("外观与站点 · 品牌与站点")
  })

  test("describeSettingsLocation：多叶子分组路径走新分组名", () => {
    expect(describeSettingsLocation("data-maintenance", "data-maintenance:compression")).toBe(
      "数据与日志 → 数据与维护 · 上下文压缩",
    )
    expect(describeSettingsLocation("models", "models:catalog")).toBe("连接与模型 → 模型管理 · 模型目录与能力")
    expect(describeSettingsLocation("session-defaults", "session-defaults:prompt")).toBe(
      "连接与模型 → 会话默认配置 · 全局系统提示词",
    )
    expect(describeSettingsLocation("reasoning-network", "reasoning-network:stream")).toBe(
      "数据与日志 → 生成与网络（高级） · 流式与传输",
    )
  })

  test("describeSettingsLocation：未知叶子或未知卡返回 null", () => {
    expect(describeSettingsLocation("nonexistent")).toBeNull()
    expect(describeSettingsLocation("extensions", "extensions:nope")).toBeNull()
    expect(describeSettingsLocation("mcp")).toBeNull()
  })
})
