import { describe, expect, test } from "vitest"
import {
  DEFAULT_SYSTEM_LEAF,
  describeSettingsLocation,
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

/** 7 个顶级条目：概览状态摘要 + 6 组导航，按渲染顺序。 */
const EXPECTED_TOP_LEVEL_KEYS = [
  "overview",
  "model-connections",
  "search-knowledge",
  "extensions",
  "users-registration",
  "data-logs",
  "branding",
]

/** 6 组导航的中文名（审计确认后固定）。 */
const EXPECTED_GROUP_LABELS = [
  "连接与模型",
  "搜索与知识库",
  "工具与扩展",
  "用户与访问",
  "数据与日志",
  "外观与站点",
]

/** 11 个叶子 key，按导航树渲染顺序。 */
const EXPECTED_LEAF_KEYS = [
  "overview",
  "connections",
  "models",
  "session-defaults",
  "search-knowledge",
  "extensions",
  "users-registration",
  "data-maintenance",
  "logs-audit",
  "reasoning-network",
  "branding",
]

/** 重构中被合并掉的旧叶子：renderSystemLeaf 必须返回 null。 */
const REMOVED_LEAF_KEYS = ["tools-extensions", "mcp", "skills-governance", "features-tools", "system-data", "advanced"]

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
  "members-security",
  "audit",
  "task-trace",
  "system-logs",
  "backup",
  "image-transcription",
]

describe("system-settings-registry", () => {
  describe("导航树结构", () => {
    test("顶级条目为「概览 + 6 组」共 7 项", () => {
      expect(systemSettingsTree.map((entry) => entry.key)).toEqual(EXPECTED_TOP_LEVEL_KEYS)
    })

    test("概览是第一个顶级条目（无 children，作为入口状态摘要）", () => {
      const first = systemSettingsTree[0]
      expect(first.key).toBe("overview")
      expect(first.label).toBe("概览")
      expect("children" in first).toBe(false)
    })

    test("6 组导航名称按审计顺序固定", () => {
      const labels = systemSettingsTree
        .filter((entry) => entry.key !== "overview")
        .map((entry) => entry.label)
      expect(labels).toEqual(EXPECTED_GROUP_LABELS)
    })

    test("只有「连接与模型」「数据与日志」是多叶子分组", () => {
      const grouped = systemSettingsTree.filter((entry) => "children" in entry)
      expect(grouped.map((group) => group.key)).toEqual(["model-connections", "data-logs"])
    })

    test("连接与模型 = 供应商与连接 / 模型管理 / 会话默认配置", () => {
      const group = systemSettingsTree.find((entry) => entry.key === "model-connections")
      expect(childrenOf(group as SystemSettingsEntry).map((leaf) => leaf.key)).toEqual([
        "connections",
        "models",
        "session-defaults",
      ])
    })

    test("数据与日志 = 数据与维护 / 日志与审计 / 生成与网络（高级）", () => {
      const group = systemSettingsTree.find((entry) => entry.key === "data-logs")
      const leaves = childrenOf(group as SystemSettingsEntry)
      expect(leaves.map((leaf) => leaf.key)).toEqual(["data-maintenance", "logs-audit", "reasoning-network"])
      expect(leaves.map((leaf) => leaf.label)).toEqual(["数据与维护", "日志与审计", "生成与网络（高级）"])
    })

    test("单叶子分组拍平为顶级叶子，旧 key 不变", () => {
      expect(findLeaf("search-knowledge")?.label).toBe("搜索与知识库")
      expect(findLeaf("extensions")?.label).toBe("工具与扩展")
      expect(findLeaf("users-registration")?.label).toBe("用户与访问")
      expect(findLeaf("branding")?.label).toBe("外观与站点")
    })

    test("推理与网络不再单独主导航，降为数据与日志下的高级子项", () => {
      expect(systemSettingsTree.some((entry) => entry.key === "reasoning-network")).toBe(false)
      expect(getWorkspaceForLeaf("reasoning-network")).toBe("data-logs")
      expect(findLeaf("reasoning-network")?.label).toBe("生成与网络（高级）")
    })

    test("会话默认配置是新增叶子，承接全局系统提示词", () => {
      expect(findLeaf("session-defaults")?.label).toBe("会话默认配置")
      expect(getWorkspaceForLeaf("session-defaults")).toBe("model-connections")
    })

    test("11 个叶子 key 全局唯一且顺序稳定", () => {
      const all = systemSettingsTree.flatMap((node) =>
        "children" in node ? node.children.map((child) => child.key) : [node.key],
      )
      expect(all).toEqual(EXPECTED_LEAF_KEYS)
      expect(new Set(all).size).toBe(EXPECTED_LEAF_KEYS.length)
    })

    test("getAllSystemLeafKeys() 与树一致", () => {
      expect(getAllSystemLeafKeys()).toEqual(EXPECTED_LEAF_KEYS)
    })
  })

  describe("leaf 渲染", () => {
    test.each(EXPECTED_LEAF_KEYS)("renderSystemLeaf(%s) 应返回有效 React 元素", (key) => {
      expect(renderSystemLeaf(key)).not.toBeNull()
    })

    test.each(REMOVED_LEAF_KEYS)("已合并/移除的分组 key %s 渲染为 null（旧值兜底回退）", (key) => {
      expect(renderSystemLeaf(key)).toBeNull()
    })

    test.each(RETIRED_KEYS)("废弃 key %s 的 renderSystemLeaf 应返回 null", (key) => {
      expect(renderSystemLeaf(key)).toBeNull()
    })

    test("renderSystemLeaf('unknown-key') 应返回 null", () => {
      expect(renderSystemLeaf("unknown-key")).toBeNull()
    })

    test("退役的图片转写叶子不破坏旧深链", () => {
      expect(renderSystemLeaf("image-transcription")).toBeNull()
      expect(systemSettingsCards.some((card) => card.leafKey === "image-transcription")).toBe(false)
    })
  })

  describe("默认 leaf", () => {
    test("DEFAULT_SYSTEM_LEAF 仍为 overview（入口即状态摘要）", () => {
      expect(DEFAULT_SYSTEM_LEAF).toBe("overview")
    })
  })

  describe("getWorkspaceForLeaf", () => {
    test("overview 属于自身顶级条目", () => {
      expect(getWorkspaceForLeaf("overview")).toBe("overview")
    })

    test.each(["search-knowledge", "extensions", "users-registration", "branding"])(
      "拍平叶子 %s 属于自身顶级条目",
      (key) => {
        expect(getWorkspaceForLeaf(key)).toBe(key)
      },
    )

    test.each(["connections", "models", "session-defaults"])("%s 属于 model-connections", (key) => {
      expect(getWorkspaceForLeaf(key)).toBe("model-connections")
    })

    test.each(["data-maintenance", "logs-audit", "reasoning-network"])("%s 属于 data-logs", (key) => {
      expect(getWorkspaceForLeaf(key)).toBe("data-logs")
    })

    test("被移除的分组/叶子返回 undefined", () => {
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
          expect(Array.isArray(leaf.keywords)).toBe(true)
          expect((leaf.keywords ?? []).length).toBeGreaterThan(0)
        }
      }
    })

    test("旧分组名不再出现在位置描述里", () => {
      expect(describeSettingsLocation("branding")).toBe("外观与站点")
      expect(describeSettingsLocation("data-maintenance")).toBe("数据与日志 → 数据与维护")
      expect(describeSettingsLocation("reasoning-network")).toBe("数据与日志 → 生成与网络（高级）")
    })
  })
})
