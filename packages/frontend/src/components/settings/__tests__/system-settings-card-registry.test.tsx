import React from "react"
import { describe, expect, test } from "vitest"
import {
  describeSettingsLocation,
  getAllSystemLeafKeys,
  systemSettingsCards,
} from "../system-settings-registry"

/** 期望的卡清单快照：leafKey -> 卡 key 列表（防止注册表误删/漂移） */
const EXPECTED_CARDS: Record<string, string[]> = {
  connections: ["quick-connect", "advanced"],
  models: ["catalog", "access"],
  "search-knowledge": ["web-search", "rag", "knowledge-base"],
  "tools-extensions": ["python-tools", "python-runtime", "skill-install", "battle", "title-summary"],
  "users-registration": ["policy", "users"],
  "skills-governance": ["approvals", "versions", "bindings"],
  branding: ["avatar", "branding"],
  "data-maintenance": ["retention", "compression", "concurrency", "task-trace", "system-log"],
  "reasoning-network": ["reasoning", "stream", "ollama", "network"],
}

describe("system-settings-card-registry", () => {
  test("每个卡的 leafKey 都指向导航树中存在的叶子", () => {
    const leafKeys = new Set(getAllSystemLeafKeys())
    for (const card of systemSettingsCards) {
      expect(leafKeys.has(card.leafKey), `卡 ${card.key} 的 leafKey ${card.leafKey} 不在导航树中`).toBe(true)
    }
  })

  test("卡 key 全局唯一，且以 leafKey 为前缀（leafKey:cardKey）", () => {
    const keys = systemSettingsCards.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const card of systemSettingsCards) {
      expect(card.key.startsWith(`${card.leafKey}:`)).toBe(true)
    }
  })

  test("卡 label 非空，keywords 可选但非空串", () => {
    for (const card of systemSettingsCards) {
      expect(card.label.trim().length).toBeGreaterThan(0)
      for (const kw of card.keywords ?? []) {
        expect(kw.trim().length).toBeGreaterThan(0)
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

  test("describeSettingsLocation：卡级路径「分组 → 叶子 · 卡」", () => {
    expect(describeSettingsLocation("data-maintenance", "data-maintenance:compression")).toBe(
      "系统与数据 → 数据与维护 · 上下文压缩"
    )
    expect(describeSettingsLocation("models", "models:catalog")).toBe("模型与连接 → 模型管理 · 模型目录与能力")
  })

  test("describeSettingsLocation：叶子级路径「分组 → 叶子」", () => {
    expect(describeSettingsLocation("data-maintenance")).toBe("系统与数据 → 数据与维护")
  })

  test("describeSettingsLocation：未知叶子或未知卡返回 null", () => {
    expect(describeSettingsLocation("nonexistent")).toBeNull()
    expect(describeSettingsLocation("data-maintenance", "data-maintenance:nope")).toBeNull()
  })
})
