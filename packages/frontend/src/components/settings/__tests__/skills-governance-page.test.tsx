import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SkillsGovernancePage } from "@/components/settings/pages/skills-governance/SkillsGovernancePage"
import type {
  SkillApprovalRequestItem,
  SkillBindingItem,
  SkillCatalogItem,
} from "@/types"

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

const skillsApiMocks = vi.hoisted(() => ({
  listSkillCatalog: vi.fn(),
  listSkillBindings: vi.fn(),
  listSkillApprovals: vi.fn(),
  respondSkillApproval: vi.fn(),
  approveSkillVersion: vi.fn(),
  activateSkillVersion: vi.fn(),
  upsertSkillBinding: vi.fn(),
  deleteSkillBinding: vi.fn(),
  previewSkillUninstall: vi.fn(),
  deleteSkill: vi.fn(),
}))
vi.mock("@/features/skills/api", () => ({
  listSkillCatalog: skillsApiMocks.listSkillCatalog,
  listSkillBindings: skillsApiMocks.listSkillBindings,
  listSkillApprovals: skillsApiMocks.listSkillApprovals,
  respondSkillApproval: skillsApiMocks.respondSkillApproval,
  approveSkillVersion: skillsApiMocks.approveSkillVersion,
  activateSkillVersion: skillsApiMocks.activateSkillVersion,
  upsertSkillBinding: skillsApiMocks.upsertSkillBinding,
  deleteSkillBinding: skillsApiMocks.deleteSkillBinding,
  previewSkillUninstall: skillsApiMocks.previewSkillUninstall,
  deleteSkill: skillsApiMocks.deleteSkill,
}))

/** 最小 Skill 目录：单个 Skill + 单个待审批版本 */
const catalogSkill: SkillCatalogItem = {
  id: 1,
  slug: "data-agent",
  displayName: "Data Agent",
  description: "数据分析助手",
  status: "active",
  versions: [
    {
      id: 3,
      version: "1.2.0",
      status: "pending_approval",
      riskLevel: "medium",
      createdAt: "2026-07-01T10:00:00Z",
      activatedAt: null,
    },
  ],
}

const approvals: SkillApprovalRequestItem[] = [
  {
    id: 21,
    skillId: 1,
    toolName: "web_search",
    status: "pending",
    requestedByActor: "user-42",
    requestedAt: "2026-07-02T10:00:00Z",
    expiresAt: "2026-07-03T10:00:00Z",
    skill: { id: 1, slug: "data-agent", displayName: "Data Agent" },
  },
]

const bindings: SkillBindingItem[] = [
  {
    id: 11,
    skillId: 1,
    versionId: 3,
    scopeType: "system",
    scopeId: "global",
    enabled: true,
    skill: { id: 1, slug: "data-agent", displayName: "Data Agent" },
  },
]

/** 卸载预览响应数据 */
const uninstallPreviewData = {
  skillId: 1,
  slug: "data-agent",
  displayName: "Data Agent",
  removedRequirements: ["numpy==2.1.0"],
  packagePaths: [],
  cleanupPlan: {
    removedSkillPackages: [],
    keptByActiveSkills: ["numpy"],
    keptByActiveSkillSources: [],
    keptByManual: [],
    removablePackages: ["pandas"],
  },
}

/** 默认 mock 行为：三个列表立即返回最小数据 */
const mockLoadedData = () => {
  skillsApiMocks.listSkillCatalog.mockResolvedValue({ data: [catalogSkill] })
  skillsApiMocks.listSkillBindings.mockResolvedValue({ data: bindings })
  skillsApiMocks.listSkillApprovals.mockResolvedValue({ data: approvals })
}

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  mockLoadedData()
  skillsApiMocks.respondSkillApproval.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.approveSkillVersion.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.activateSkillVersion.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.upsertSkillBinding.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.deleteSkillBinding.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.previewSkillUninstall.mockResolvedValue({ success: true, data: uninstallPreviewData })
  skillsApiMocks.deleteSkill.mockResolvedValue({ success: true, data: {} })
})

afterEach(() => {
  cleanup()
})

describe("SkillsGovernancePage", () => {
  test("渲染页头「Skill 治理」+ 副标题 + 三个 section 标题", async () => {
    render(<SkillsGovernancePage />)

    expect(screen.getByText("Skill 治理")).toBeInTheDocument()
    expect(screen.getByText("审批调用、版本管理与绑定策略")).toBeInTheDocument()
    expect(await screen.findByText("待审批调用")).toBeInTheDocument()
    expect(screen.getByText("Skill 版本管理")).toBeInTheDocument()
    expect(screen.getByText("绑定策略")).toBeInTheDocument()
  })

  test("「Skill 安装」标题不可见（安装 section 已迁出）", async () => {
    render(<SkillsGovernancePage />)
    await screen.findByText("待审批调用")

    expect(screen.queryByText("Skill 安装")).not.toBeInTheDocument()
  })

  test("待审批行点「批准」→ respondSkillApproval(requestId, {approved:true})", async () => {
    render(<SkillsGovernancePage />)
    await screen.findByText("web_search")

    await userEvent.click(screen.getByRole("button", { name: "批准" }))

    await waitFor(() => {
      expect(skillsApiMocks.respondSkillApproval).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.respondSkillApproval).toHaveBeenCalledWith(21, { approved: true })
    // 行从表格消失
    await waitFor(() => {
      expect(screen.queryByText("web_search")).not.toBeInTheDocument()
    })
  })

  test("版本行点「激活并设默认」→ activateSkillVersion(skillId, versionId, {makeDefault:true})", async () => {
    render(<SkillsGovernancePage />)
    // 唯一版本行（1.2.0）上的按钮；按钮位于「批准版本」同一行内
    const activateButton = (await screen.findByRole("button", { name: "激活并设默认" })) as HTMLButtonElement

    await userEvent.click(activateButton)

    await waitFor(() => {
      expect(skillsApiMocks.activateSkillVersion).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.activateSkillVersion).toHaveBeenCalledWith(1, 3, { makeDefault: true })
  })

  test("绑定表单保存 → upsertSkillBinding（payload 断言）", async () => {
    render(<SkillsGovernancePage />)
    await screen.findByText("绑定策略")

    fireEvent.change(screen.getByPlaceholderText('例如：{"approval":"once_per_session"}'), {
      target: { value: '{"approval":"once_per_session"}' },
    })
    await userEvent.click(screen.getByRole("button", { name: "保存绑定" }))

    await waitFor(() => {
      expect(skillsApiMocks.upsertSkillBinding).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.upsertSkillBinding).toHaveBeenCalledWith({
      skillId: 1,
      versionId: null,
      scopeType: "system",
      scopeId: "global",
      enabled: true,
      policy: { approval: "once_per_session" },
      overrides: {},
    })
  })

  test("卸载：点「卸载 Skill」→ 预览 Dialog → 确认 → deleteSkill(skillId)", async () => {
    render(<SkillsGovernancePage />)
    const uninstallButton = (await screen.findByRole("button", { name: "卸载 Skill" })) as HTMLButtonElement

    await userEvent.click(uninstallButton)

    // 预览 Dialog 出现（mock previewSkillUninstall 已调用）
    await waitFor(() => {
      expect(skillsApiMocks.previewSkillUninstall).toHaveBeenCalledWith(1)
    })
    expect(await screen.findByText("卸载 Skill 前预览回收计划")).toBeInTheDocument()
    expect(screen.getByText("确认卸载 Skill")).toBeInTheDocument()

    // 确认删除
    await userEvent.click(screen.getByRole("button", { name: "确认卸载 Skill" }))

    await waitFor(() => {
      expect(skillsApiMocks.deleteSkill).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.deleteSkill).toHaveBeenCalledWith(1)
    // Dialog 关闭
    await waitFor(() => {
      expect(screen.queryByText("卸载 Skill 前预览回收计划")).not.toBeInTheDocument()
    })
  })

  test("loading 时三 section 渲染加载文案，resolve 后渲染内容", async () => {
    let resolveCatalog: (value: { data: SkillCatalogItem[] }) => void = () => {}
    let resolveBindings: (value: { data: SkillBindingItem[] }) => void = () => {}
    let resolveApprovals: (value: { data: SkillApprovalRequestItem[] }) => void = () => {}
    skillsApiMocks.listSkillCatalog.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCatalog = resolve
        }),
    )
    skillsApiMocks.listSkillBindings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBindings = resolve
        }),
    )
    skillsApiMocks.listSkillApprovals.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprovals = resolve
        }),
    )

    render(<SkillsGovernancePage />)

    // 待审批与版本 section 为 loading 文案（绑定策略 section 无 loading 态，源行为一致）
    expect(screen.getAllByText("加载中...").length).toBe(2)
    expect(screen.queryByText("web_search")).not.toBeInTheDocument()
    expect(screen.getByText("暂无绑定。")).toBeInTheDocument()

    await act(async () => {
      resolveCatalog({ data: [catalogSkill] })
      resolveBindings({ data: bindings })
      resolveApprovals({ data: approvals })
    })

    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument()
    })
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument()
  })
})
