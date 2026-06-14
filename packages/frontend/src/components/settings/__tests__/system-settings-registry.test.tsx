import React from "react"
import { describe, expect, test } from "vitest"
import { systemSettingsTree, renderSystemLeaf, DEFAULT_SYSTEM_LEAF, getWorkspaceForLeaf } from "../system-settings-registry"

describe("system-settings-registry", () => {
  describe("导航树结构", () => {
    const workspaces = systemSettingsTree

    test("应有 5 个工作域", () => {
      expect(workspaces).toHaveLength(5)
    })

    test("第一个工作域应是「配置中心」", () => {
      expect(workspaces[0].label).toBe("配置中心")
      expect(workspaces[0].key).toBe("configuration-center")
    })

    test("「配置中心」应包含概览、模型管理、连接管理、模型权限、推理配置、通用设置、网络与超时", () => {
      const cfg = workspaces[0]
      const labels = cfg.children.map((c) => c.label)
      expect(labels).toEqual([
        "概览",
        "模型管理",
        "连接管理",
        "模型权限",
        "推理配置",
        "通用设置",
        "网络与超时",
      ])
    })

    test("「知识库与文档」应包含 RAG 文档解析、知识库管理", () => {
      const ws = workspaces[1]
      expect(ws.label).toBe("知识库与文档")
      expect(ws.children.map((c) => c.label)).toEqual(["RAG 文档解析", "知识库管理"])
    })

    test("「工具与运行时」应包含联网搜索、Python 运行时、MCP 管理", () => {
      const ws = workspaces[2]
      expect(ws.label).toBe("工具与运行时")
      expect(ws.children.map((c) => c.label)).toEqual(["联网搜索", "Python 运行时", "MCP 管理"])
    })

    test("「治理与审计」应包含成员与权限、Skill 管理、审计日志、任务追踪、系统运行日志", () => {
      const ws = workspaces[3]
      expect(ws.label).toBe("治理与审计")
      expect(ws.children.map((c) => c.label)).toEqual(["成员与权限", "Skill 管理", "审计日志", "任务追踪", "系统运行日志"])
    })

    test("「运行维护」应包含运行监控与保留策略", () => {
      const ws = workspaces[4]
      expect(ws.label).toBe("运行维护")
      expect(ws.children.map((c) => c.label)).toEqual(["运行监控与保留策略"])
    })
  })

  describe("leaf 渲染", () => {
    test("renderSystemLeaf('connections') 应返回有效 React 元素", () => {
      const el = renderSystemLeaf("connections")
      expect(el).not.toBeNull()
    })

    test("renderSystemLeaf('models') 应返回有效 React 元素", () => {
      expect(renderSystemLeaf("models")).not.toBeNull()
    })

    test("renderSystemLeaf('network') 应返回有效 React 元素", () => {
      expect(renderSystemLeaf("network")).not.toBeNull()
    })

    test("renderSystemLeaf('task-trace') 应返回有效 React 元素", () => {
      expect(renderSystemLeaf("task-trace")).not.toBeNull()
    })

    test("renderSystemLeaf('system-logs') 应返回有效 React 元素", () => {
      expect(renderSystemLeaf("system-logs")).not.toBeNull()
    })

    test("renderSystemLeaf('logs') 应返回 null（已被拆分为独立菜单）", () => {
      expect(renderSystemLeaf("logs")).toBeNull()
    })

    test("renderSystemLeaf('unknown-key') 应返回 null", () => {
      expect(renderSystemLeaf("unknown-key")).toBeNull()
    })
  })

  describe("默认 leaf", () => {
    test("DEFAULT_SYSTEM_LEAF 应为 connections", () => {
      expect(DEFAULT_SYSTEM_LEAF).toBe("connections")
    })
  })

  describe("getWorkspaceForLeaf", () => {
    test("connections 属于 configuration-center", () => {
      expect(getWorkspaceForLeaf("connections")).toBe("configuration-center")
    })

    test("rag 属于 knowledge-docs", () => {
      expect(getWorkspaceForLeaf("rag")).toBe("knowledge-docs")
    })

    test("backup 属于 operations", () => {
      expect(getWorkspaceForLeaf("backup")).toBe("operations")
    })

    test("task-trace 属于 audit-governance", () => {
      expect(getWorkspaceForLeaf("task-trace")).toBe("audit-governance")
    })

    test("system-logs 属于 audit-governance", () => {
      expect(getWorkspaceForLeaf("system-logs")).toBe("audit-governance")
    })

    test("logs 应返回 undefined（已被移除）", () => {
      expect(getWorkspaceForLeaf("logs")).toBeUndefined()
    })

    test("unknown key 应返回 undefined", () => {
      expect(getWorkspaceForLeaf("nonexistent")).toBeUndefined()
    })
  })
})
