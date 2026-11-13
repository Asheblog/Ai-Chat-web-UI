import { describe, expect, test } from "vitest"
import { Layers } from "lucide-react"
import {
  DEFAULT_SYSTEM_LEAF,
  getAllSystemLeafKeys,
  getWorkspaceForLeaf,
  renderSystemLeaf,
  systemSettingsCards,
  systemSettingsTree,
  type SystemLeafMeta,
  type SystemSettingsEntry,
} from "../system-settings-registry"

const childrenOf = (node: SystemSettingsEntry): SystemLeafMeta[] =>
  "children" in node ? node.children : []

const findLeaf = (key: string): SystemLeafMeta | undefined => {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      const found = entry.children.find((child) => child.key === key)
      if (found) return found
    } else if (entry.key === key) {
      return entry
    }
  }
  return undefined
}

/** 10 个叶子，按导航树渲染顺序。 */
const EXPECTED_LEAF_KEYS = [
  "overview",
  "connections",
  "models",
  "search-knowledge",
  "extensions",
  "users-registration",
  "branding",
  "logs-audit",
  "data-maintenance",
  "reasoning-network",
]

/** 三页合一后被移除的叶子：renderSystemLeaf 必须返回 null（旧 localStorage 值靠它兜底回退）。 */
const REMOVED_LEAF_KEYS = ["tools-extensions", "mcp", "skills-governance"]

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
  "skills-governance",
  "audit",
  "task-trace",
  "system-logs",
  "backup",
]

describe("system-settings-registry", () => {
  describe("导航树结构", () => {
    test("应有 6 个顶级条目（4 分组 + 2 顶级叶）", () => {
      expect(systemSettingsTree).toHaveLength(6)
    })

    test("第一个顶级条目是概览叶子（无 children）", () => {
      const first = systemSettingsTree[0]
      expect(first.key).toBe("overview")
      expect(first.label).toBe("概览")
      expect("children" in first).toBe(false)
    })

    test("顶级条目 key 顺序正确（用户与注册拍平为顶级叶）", () => {
      expect(systemSettingsTree.map((entry) => entry.key)).toEqual([
        "overview",
        "model-connections",
        "features-tools",
        "users-registration",
        "system-data",
        "advanced",
      ])
    })

    test("4 个分组 key 依次为 model-connections / features-tools / system-data / advanced", () => {
      const groups = systemSettingsTree.filter((entry) => "children" in entry)
      expect(groups.map((group) => group.key)).toEqual([
        "model-connections",
        "features-tools",
        "system-data",
        "advanced",
      ])
      expect(groups.map((group) => group.label)).toEqual(["模型与连接", "功能与工具", "系统与数据", "高级设置"])
    })

    test("每个分组 children 数量正确（2/2/3/1）", () => {
      expect(childrenOf(systemSettingsTree[1])).toHaveLength(2)
      expect(childrenOf(systemSettingsTree[2])).toHaveLength(2)
      expect(childrenOf(systemSettingsTree[4])).toHaveLength(3)
      expect(childrenOf(systemSettingsTree[5])).toHaveLength(1)
    })

    test("features-tools.children 为 [search-knowledge, extensions]", () => {
      expect(childrenOf(systemSettingsTree[2]).map((leaf) => leaf.key)).toEqual([
        "search-knowledge",
        "extensions",
      ])
    })

    test("users-registration 提升为顶级叶子（无 children，label 用户与注册）", () => {
      const entry = systemSettingsTree[3]
      expect(entry.key).toBe("users-registration")
      expect(entry.label).toBe("用户与注册")
      expect("children" in entry).toBe(false)
      expect(findLeaf("users-registration")).toEqual(entry)
    })

    test("不存在「成员与安全」分组", () => {
      expect(systemSettingsTree.some((entry) => entry.key === "members-security")).toBe(false)
    })

    test("extensions 叶子元数据（label / icon / keywords）", () => {
      const leaf = findLeaf("extensions")
      expect(leaf).toBeDefined()
      expect(leaf?.label).toBe("能力扩展")
      expect(leaf?.icon).toBe(Layers)
      expect(leaf?.keywords).toEqual([
        "MCP",
        "模型上下文协议",
        "Skill",
        "Python",
        "扩展",
        "工具",
        "审批",
        "绑定",
        "凭据",
        "安装",
        "大乱斗",
        "标题",
      ])
    })

    test("10 个叶子 key 全局唯一且顺序稳定", () => {
      const all = systemSettingsTree.flatMap((node) =>
        "children" in node ? node.children.map((child) => child.key) : [node.key],
      )
      expect(all).toEqual(EXPECTED_LEAF_KEYS)
      expect(new Set(all).size).toBe(10)
    })

    test("getAllSystemLeafKeys() 恰好 10 个且不含旧三叶", () => {
      const keys = getAllSystemLeafKeys()
      expect(keys).toEqual(EXPECTED_LEAF_KEYS)
      expect(new Set(keys).size).toBe(10)
      for (const removed of REMOVED_LEAF_KEYS) {
        expect(keys).not.toContain(removed)
      }
    })
  })

  describe("leaf 渲染", () => {
    test.each(EXPECTED_LEAF_KEYS)("renderSystemLeaf(%s) 应返回有效 React 元素", (key) => {
      expect(renderSystemLeaf(key)).not.toBeNull()
    })

    test.each(REMOVED_LEAF_KEYS)("被移除的叶子 %s 的 renderSystemLeaf 应返回 null", (key) => {
      expect(renderSystemLeaf(key)).toBeNull()
    })

    test.each(RETIRED_KEYS)("废弃 key %s 的 renderSystemLeaf 应返回 null", (key) => {
      expect(renderSystemLeaf(key)).toBeNull()
    })

    test("renderSystemLeaf('unknown-key') 应返回 null", () => {
      expect(renderSystemLeaf("unknown-key")).toBeNull()
    })

    test("退役的图片转写叶子不破坏旧深链（renderSystemLeaf 返回 null、卡片同步下线）", () => {
      expect(renderSystemLeaf("image-transcription")).toBeNull()
      expect(systemSettingsCards.some((card) => card.leafKey === "image-transcription")).toBe(false)
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

    test("users-registration 属于自身顶级条目（不再是 members-security）", () => {
      expect(getWorkspaceForLeaf("users-registration")).toBe("users-registration")
    })

    test("extensions 属于 features-tools", () => {
      expect(getWorkspaceForLeaf("extensions")).toBe("features-tools")
    })

    test.each(["connections", "models"])("%s 属于 model-connections", (key) => {
      expect(getWorkspaceForLeaf(key)).toBe("model-connections")
    })

    test("search-knowledge 属于 features-tools", () => {
      expect(getWorkspaceForLeaf("search-knowledge")).toBe("features-tools")
    })

    test.each(["branding", "logs-audit", "data-maintenance"])("%s 属于 system-data", (key) => {
      expect(getWorkspaceForLeaf(key)).toBe("system-data")
    })

    test("reasoning-network 属于 advanced", () => {
      expect(getWorkspaceForLeaf("reasoning-network")).toBe("advanced")
    })

    test("被移除的叶子返回 undefined", () => {
      for (const removed of REMOVED_LEAF_KEYS) {
        expect(getWorkspaceForLeaf(removed)).toBeUndefined()
      }
    })

    test("unknown key 应返回 undefined", () => {
      expect(getWorkspaceForLeaf("nonexistent")).toBeUndefined()
    })
  })

  describe("leaf 元数据", () => {
    test("每个叶子有 label 与 icon", () => {
      for (const node of systemSettingsTree) {
        const leaves: SystemLeafMeta[] = "children" in node ? node.children : [node]
        for (const leaf of leaves) {
          expect(leaf.label).toBeTruthy()
          expect(leaf.icon).toBeDefined()
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
