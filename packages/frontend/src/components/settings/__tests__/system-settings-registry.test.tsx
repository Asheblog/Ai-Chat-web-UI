import React from "react"
import { describe, expect, test } from "vitest"
import {
  systemSettingsTree,
  renderSystemLeaf,
  DEFAULT_SYSTEM_LEAF,
  getWorkspaceForLeaf,
  getAllSystemLeafKeys,
  type SystemSettingsEntry,
  type SystemLeafMeta,
} from "../system-settings-registry"

const childrenOf = (node: SystemSettingsEntry): SystemLeafMeta[] =>
  "children" in node ? node.children : []

const NEW_LEAF_KEYS = [
  "overview",
  "connections",
  "models",
  "image-transcription",
  "search-knowledge",
  "tools-extensions",
  "mcp",
  "users-registration",
  "skills-governance",
  "branding",
  "logs-audit",
  "data-maintenance",
  "reasoning-network",
]

const RETIRED_KEYS = [
  "api-routing",
  "token-management",
  "system-config",
  "network",
  "web-search",
  "rag",
  "knowledge-base",
  "python-runtime",
  "skills",
  "members",
  "audit",
  "task-trace",
  "system-logs",
  "backup",
]

describe("system-settings-registry", () => {
  describe("导航树结构", () => {
    test("应有 6 个顶级条目", () => {
      expect(systemSettingsTree).toHaveLength(6)
    })

    test("第一个顶级条目是概览叶子（无 children）", () => {
      const first = systemSettingsTree[0]
      expect(first.key).toBe("overview")
      expect(first.label).toBe("概览")
      expect("children" in first).toBe(false)
    })

    test("5 个分组 label 与 key 正确", () => {
      const groups = systemSettingsTree.slice(1)
      expect(groups.map((g) => g.key)).toEqual([
        "model-connections",
        "features-tools",
        "members-security",
        "system-data",
        "advanced",
      ])
      expect(groups.map((g) => g.label)).toEqual([
        "模型与连接",
        "功能与工具",
        "成员与安全",
        "系统与数据",
        "高级设置",
      ])
    })

    test("每个分组 children 数量正确（3/3/2/3/1）", () => {
      expect(childrenOf(systemSettingsTree[1])).toHaveLength(3)
      expect(childrenOf(systemSettingsTree[2])).toHaveLength(3)
      expect(childrenOf(systemSettingsTree[3])).toHaveLength(2)
      expect(childrenOf(systemSettingsTree[4])).toHaveLength(3)
      expect(childrenOf(systemSettingsTree[5])).toHaveLength(1)
    })

    test("13 个叶子 key 全局唯一", () => {
      const all = systemSettingsTree.flatMap((node) =>
        "children" in node ? node.children.map((c) => c.key) : [node.key]
      )
      expect(all).toHaveLength(13)
      expect(new Set(all).size).toBe(13)
    })

    test("getAllSystemLeafKeys() 恰好 13 个", () => {
      expect(getAllSystemLeafKeys()).toHaveLength(13)
      expect(new Set(getAllSystemLeafKeys()).size).toBe(13)
    })
  })

  describe("leaf 渲染", () => {
    test.each(NEW_LEAF_KEYS)("renderSystemLeaf(%s) 应返回有效 React 元素", (key) => {
      expect(renderSystemLeaf(key)).not.toBeNull()
    })

    test.each(RETIRED_KEYS)("废弃 key %s 的 renderSystemLeaf 应返回 null", (key) => {
      expect(renderSystemLeaf(key)).toBeNull()
    })

    test("renderSystemLeaf('unknown-key') 应返回 null", () => {
      expect(renderSystemLeaf("unknown-key")).toBeNull()
    })
  })

  describe("默认 leaf", () => {
    test("DEFAULT_SYSTEM_LEAF 应为 overview", () => {
      expect(DEFAULT_SYSTEM_LEAF).toBe("overview")
    })
  })

  describe("getWorkspaceForLeaf", () => {
    test("overview 属于自身顶级条目 overview", () => {
      expect(getWorkspaceForLeaf("overview")).toBe("overview")
    })

    test.each(["connections", "models", "image-transcription"])("%s 属于 model-connections", (key) => {
      expect(getWorkspaceForLeaf(key)).toBe("model-connections")
    })

    test.each(["search-knowledge", "tools-extensions", "mcp"])(
      "%s 属于 features-tools",
      (key) => {
        expect(getWorkspaceForLeaf(key)).toBe("features-tools")
      }
    )

    test.each(["users-registration", "skills-governance"])(
      "%s 属于 members-security",
      (key) => {
        expect(getWorkspaceForLeaf(key)).toBe("members-security")
      }
    )

    test.each(["branding", "logs-audit", "data-maintenance"])(
      "%s 属于 system-data",
      (key) => {
        expect(getWorkspaceForLeaf(key)).toBe("system-data")
      }
    )

    test("reasoning-network 属于 advanced", () => {
      expect(getWorkspaceForLeaf("reasoning-network")).toBe("advanced")
    })

    test("unknown key 应返回 undefined", () => {
      expect(getWorkspaceForLeaf("nonexistent")).toBeUndefined()
    })
  })

  describe("leaf 元数据", () => {
    test("每个叶子有 label 与 icon", () => {
      for (const node of systemSettingsTree) {
        if ("children" in node) {
          for (const leaf of node.children) {
            expect(leaf.label).toBeTruthy()
            expect(leaf.icon).toBeDefined()
          }
        } else {
          expect(node.label).toBeTruthy()
          expect(node.icon).toBeDefined()
        }
      }
    })

    test("每个叶子 keywords 存在（搜索阶段用）", () => {
      for (const node of systemSettingsTree) {
        const leaves: SystemLeafMeta[] = "children" in node ? node.children : [node]
        for (const leaf of leaves) {
          const keywords = leaf.keywords
          expect(Array.isArray(keywords)).toBe(true)
          expect((keywords ?? []).length).toBeGreaterThan(0)
        }
      }
    })
  })
})
