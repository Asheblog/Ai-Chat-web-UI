import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  SkillSection,
  type SkillSegment,
} from "@/components/settings/pages/extensions/sections/skill-section"
import type { SkillApprovalRequestItem, SkillBindingItem, SkillCatalogItem } from "@/types"

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

/** 段内会用到 Skills API 的全部导出：列表三路 + 审批/版本/卸载/绑定/安装动作 */
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
  installSkillFromGithub: vi.fn(),
}))
vi.mock("@/features/skills/api", () => skillsApiMocks)

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const refreshSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())

function mockSettings(settings: Record<string, unknown> | null) {
  useSystemSettingsMock.mockReturnValue({
    settings,
    isLoading: false,
    error: null,
    refresh: refreshSpy,
    update: updateSpy,
    clearError: vi.fn(),
  })
}

/** 两个版本：1.2.0 待审批（渲染「批准版本」）、1.1.0 已激活 */
const catalogSkill: SkillCatalogItem = {
  id: 1, slug: "data-agent", displayName: "Data Agent", description: "数据分析助手", status: "active",
  versions: [
    { id: 3, version: "1.2.0", status: "pending_approval", riskLevel: "medium", createdAt: "2026-07-01T10:00:00Z", activatedAt: null },
    { id: 4, version: "1.1.0", status: "active", riskLevel: "low", createdAt: "2026-06-01T10:00:00Z", activatedAt: "2026-06-02T10:00:00Z" },
  ],
}

const approvals: SkillApprovalRequestItem[] = [
  {
    id: 21, skillId: 1, toolName: "web_search", status: "pending", requestedByActor: "user-42",
    requestedAt: "2026-07-02T10:00:00Z", expiresAt: "2026-07-03T10:00:00Z",
    skill: { id: 1, slug: "data-agent", displayName: "Data Agent" },
  },
]

const bindings: SkillBindingItem[] = [
  {
    id: 11, skillId: 1, versionId: 3, scopeType: "system", scopeId: "global", enabled: true,
    skill: { id: 1, slug: "data-agent", displayName: "Data Agent" },
  },
]

/** 卸载预览：声明 1 个依赖，可回收 pandas，numpy 被激活 Skill 占用 */
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

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  refreshSpy.mockReturnValue(Promise.resolve())
  updateSpy.mockReturnValue(Promise.resolve())
  mockSettings({ chatDynamicSkillRuntimeEnabled: false })
  skillsApiMocks.listSkillCatalog.mockResolvedValue({ data: [catalogSkill] })
  skillsApiMocks.listSkillBindings.mockResolvedValue({ data: bindings })
  skillsApiMocks.listSkillApprovals.mockResolvedValue({ data: approvals })
  skillsApiMocks.respondSkillApproval.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.approveSkillVersion.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.activateSkillVersion.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.upsertSkillBinding.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.deleteSkillBinding.mockResolvedValue({ success: true, data: {} })
  skillsApiMocks.previewSkillUninstall.mockResolvedValue({ success: true, data: uninstallPreviewData })
  skillsApiMocks.deleteSkill.mockResolvedValue({
    success: true,
    data: { pythonCleanup: { removedPackages: ["pandas", "numpy"] } },
  })
  skillsApiMocks.installSkillFromGithub.mockResolvedValue({ success: true, data: {} })
})

afterEach(() => {
  cleanup()
})

/** 次级标签由页面持有：这里包一层受控外壳模拟 ExtensionsPage。 */
function SkillHarness({ initialSegment }: { initialSegment?: SkillSegment }) {
  const [segment, setSegment] = React.useState<SkillSegment>(initialSegment ?? "install")
  return <SkillSection segment={segment} onSegmentChange={setSegment} />
}

/** 冲掉 hook 三路数据请求的 promise，避免异步 setState 脱离 act。 */
async function renderSkill(initialSegment?: SkillSegment) {
  const view = render(<SkillHarness initialSegment={initialSegment} />)
  await act(async () => {})
  return view
}

describe("Skill 段：四标签与页头", () => {
  test("4 个次级标签顺序固定，默认落「安装」并挂上卡 key", async () => {
    skillsApiMocks.listSkillApprovals.mockResolvedValue({ data: [] })

    const { container } = await renderSkill()

    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
      "安装",
      "待审批",
      "版本",
      "绑定",
    ])
    expect(screen.getByRole("heading", { name: "Skill" })).toBeInTheDocument()
    expect(screen.getByText("安装、审批与绑定第三方 Skill")).toBeInTheDocument()
    // 安装段直接渲染既有 SkillInstallSection（无 FeatureCard 外壳）
    expect(screen.getByRole("button", { name: "安装" })).toBeInTheDocument()
    expect(container.querySelector('[data-card-key="extensions:skill-install"]')).not.toBeNull()
  })

  test("「待审批」标签显示数量徽标，切段后渲染审批表", async () => {
    await renderSkill()
    const approvalsTab = screen.getByRole("tab", { name: /待审批/ })
    expect(within(approvalsTab).getByText("1")).toBeInTheDocument()

    fireEvent.click(approvalsTab)

    expect(screen.getByText("待审批调用")).toBeInTheDocument()
    expect(screen.getByText("web_search")).toBeInTheDocument()
  })

  test("顶部开关走共享 store，只写一次 { chatDynamicSkillRuntimeEnabled: true }", async () => {
    await renderSkill()

    expect(screen.getByText("运行时 未开启")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "动态 Skill Runtime 开关" }))
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith({ chatDynamicSkillRuntimeEnabled: true })
  })
})

describe("Skill 段：版本", () => {
  test("两版本渲染「批准版本」与「激活并设默认」，点击分别调用审批/激活接口", async () => {
    await renderSkill("versions")

    const approveButtons = await screen.findAllByRole("button", { name: "批准版本" })
    expect(approveButtons).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "激活并设默认" })).toHaveLength(2)

    await userEvent.click(approveButtons[0])
    await waitFor(() => {
      expect(skillsApiMocks.approveSkillVersion).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.approveSkillVersion).toHaveBeenCalledWith(1, 3)

    await userEvent.click(screen.getAllByRole("button", { name: "激活并设默认" })[0])
    await waitFor(() => {
      expect(skillsApiMocks.activateSkillVersion).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.activateSkillVersion).toHaveBeenCalledWith(1, 3, { makeDefault: true })
  })

  test("版本段加载中显示加载文案", async () => {
    skillsApiMocks.listSkillCatalog.mockImplementation(() => new Promise(() => {}))

    await renderSkill("versions")

    expect(screen.getByText("加载中...")).toBeInTheDocument()
  })
})

describe("Skill 段：卸载", () => {
  test("先预览回收计划再确认卸载，toast 文案含「已自动回收 2 个 Python 包」", async () => {
    await renderSkill("versions")

    await userEvent.click(await screen.findByRole("button", { name: "卸载 Skill" }))

    await waitFor(() => {
      expect(skillsApiMocks.previewSkillUninstall).toHaveBeenCalledWith(1)
    })
    expect(await screen.findByText("卸载 Skill 前预览回收计划")).toBeInTheDocument()
    expect(screen.getByText("将自动删除")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "确认卸载 Skill" }))

    await waitFor(() => {
      expect(skillsApiMocks.deleteSkill).toHaveBeenCalledWith(1)
    })
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Skill 已卸载",
      description: "已自动回收 2 个 Python 包",
    })
    await waitFor(() => {
      expect(screen.queryByText("卸载 Skill 前预览回收计划")).not.toBeInTheDocument()
    })
  })
})

describe("Skill 段：绑定", () => {
  test("保存绑定调用 upsertSkillBinding 一次，payload 与改前一致", async () => {
    await renderSkill("bindings")

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
})

describe("Skill 段：安装与审批动作", () => {
  test("安装成功后 toast 提示去「待审批」或「版本」继续", async () => {
    await renderSkill()

    fireEvent.change(
      screen.getByPlaceholderText("owner/repo@ref[:subdir] 或 github.com/.../SKILL.md"),
      { target: { value: "anthropics/skills@main:skills/pptx" } },
    )
    await userEvent.click(screen.getByRole("button", { name: "安装" }))

    await waitFor(() => {
      expect(skillsApiMocks.installSkillFromGithub).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.installSkillFromGithub).toHaveBeenCalledWith({
      source: "anthropics/skills@main:skills/pptx",
      token: undefined,
    })
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Skill 安装请求已完成",
      description: "已提交安装，去「待审批」或「版本」继续",
    })
  })

  test("待审批行点「批准」→ respondSkillApproval(requestId, {approved:true})", async () => {
    await renderSkill("approvals")

    await userEvent.click(await screen.findByRole("button", { name: "批准" }))

    await waitFor(() => {
      expect(skillsApiMocks.respondSkillApproval).toHaveBeenCalledTimes(1)
    })
    expect(skillsApiMocks.respondSkillApproval).toHaveBeenCalledWith(21, { approved: true })
    await waitFor(() => {
      expect(screen.queryByText("web_search")).not.toBeInTheDocument()
    })
  })
})
