import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SystemSkillAuditsPage } from "@/components/settings/pages/SystemSkillAudits"
import type { SkillCatalogItem, SkillExecutionAuditItem } from "@/types"

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock("@/store/auth-store", () => ({
  useAuthStore: useAuthStoreMock,
}))

const skillsApiMocks = vi.hoisted(() => ({
  listSkillAudits: vi.fn(),
  listSkillCatalog: vi.fn(),
}))
vi.mock("@/features/skills/api", () => ({
  listSkillAudits: skillsApiMocks.listSkillAudits,
  listSkillCatalog: skillsApiMocks.listSkillCatalog,
}))

const systemApiMocks = vi.hoisted(() => ({
  getTaskTraces: vi.fn(),
  getTaskTrace: vi.fn(),
  deleteAllTaskTraces: vi.fn(),
  deleteLatexTrace: vi.fn(),
  deleteTaskTrace: vi.fn(),
  exportLatexTrace: vi.fn(),
  exportTaskTrace: vi.fn(),
  getLatexTraceEvents: vi.fn(),
  getSystemLogs: vi.fn(),
  getSystemLogTags: vi.fn(),
}))
vi.mock("@/features/system/api", () => systemApiMocks)

const catalogSkill: SkillCatalogItem = {
  id: 1,
  slug: "data-agent",
  displayName: "Data Agent",
  description: "数据分析助手",
  status: "active",
  versions: [],
}

const auditItem: SkillExecutionAuditItem = {
  id: 101,
  skillId: 1,
  sessionId: 42,
  battleRunId: null,
  toolName: "web_search",
  approvalStatus: "approved",
  durationMs: 320,
  error: null,
  createdAt: "2026-07-01T10:00:00Z",
  skill: { id: 1, slug: "data-agent", displayName: "Data Agent" },
  version: { id: 3, version: "1.2.0", status: "active" },
}

const mockUseAuthStore = () => {
  useAuthStoreMock.mockImplementation((selector: any) =>
    selector({ actorState: "authenticated", user: { role: "ADMIN" } }),
  )
}

const mockLoadedData = () => {
  skillsApiMocks.listSkillCatalog.mockResolvedValue({ data: [catalogSkill] })
  skillsApiMocks.listSkillAudits.mockResolvedValue({
    success: true,
    data: { items: [auditItem], page: 1, pageSize: 50, total: 1, hasMore: false },
  })
  systemApiMocks.getTaskTraces.mockResolvedValue({ data: { items: [], total: 0 } })
  systemApiMocks.getSystemLogs.mockResolvedValue({ data: { items: [], total: 0, hasMore: false } })
  systemApiMocks.getSystemLogTags.mockResolvedValue({ data: { tags: [] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  mockUseAuthStore()
  mockLoadedData()
})

afterEach(() => {
  cleanup()
})

describe("SystemSkillAuditsPage", () => {
  test("渲染 3 个 tab 按钮（Skill 审计/任务追踪/运行日志）", async () => {
    render(<SystemSkillAuditsPage />)

    // 等待首屏异步查询结束，避免测试结束后仍有未包裹的 state 更新
    await waitFor(() => {
      expect(skillsApiMocks.listSkillAudits).toHaveBeenCalled()
    })

    expect(screen.getByRole("button", { name: "Skill 审计" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "任务追踪" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "运行日志" })).toBeInTheDocument()
  })

  test("默认显示 skill-audit 内容（查询面板可见）", async () => {
    render(<SystemSkillAuditsPage />)

    // titleOf 生效：`${label}日志`
    expect(screen.getByRole("heading", { name: "Skill 审计日志" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "审计结果" })).toBeInTheDocument()
    // 查询面板
    expect(screen.getByText("Tool")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "查询" })).toBeInTheDocument()
    // 审计行加载
    expect(await screen.findByText("web_search")).toBeInTheDocument()
    expect(screen.getByText("共 1 条，页码 1/1")).toBeInTheDocument()
  })

  test("点击「任务追踪」不崩溃（TaskTraceConsole 挂载）", async () => {
    render(<SystemSkillAuditsPage />)
    await screen.findByText("web_search")

    fireEvent.click(screen.getByRole("button", { name: "任务追踪" }))

    // 激活态切换 + TaskTraceConsole 挂载（admin 下触发 getTaskTraces 拉取）
    expect(screen.getByRole("button", { name: "任务追踪" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Skill 审计" })).toHaveAttribute("aria-pressed", "false")
    await waitFor(() => {
      expect(systemApiMocks.getTaskTraces).toHaveBeenCalled()
    })
    expect(screen.queryByText("web_search")).not.toBeInTheDocument()
  })
})
