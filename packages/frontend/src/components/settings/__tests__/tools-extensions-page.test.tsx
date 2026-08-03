import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ToolsExtensionsPage } from "@/components/settings/pages/tools-extensions/ToolsExtensionsPage"
import type { PythonRuntimeStatus, SystemSettings } from "@/types"
import { baseSettings } from "./system-settings-pages.fixtures"

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const runtimeApiMocks = vi.hoisted(() => ({
  getPythonRuntimeStatus: vi.fn(),
  updatePythonRuntimeIndexes: vi.fn(),
  installPythonRuntimeRequirements: vi.fn(),
  uninstallPythonRuntimePackages: vi.fn(),
  reconcilePythonRuntime: vi.fn(),
}))
vi.mock("@/features/settings/api", () => ({
  getPythonRuntimeStatus: runtimeApiMocks.getPythonRuntimeStatus,
  updatePythonRuntimeIndexes: runtimeApiMocks.updatePythonRuntimeIndexes,
  installPythonRuntimeRequirements: runtimeApiMocks.installPythonRuntimeRequirements,
  uninstallPythonRuntimePackages: runtimeApiMocks.uninstallPythonRuntimePackages,
  reconcilePythonRuntime: runtimeApiMocks.reconcilePythonRuntime,
}))

const skillsApiMocks = vi.hoisted(() => ({
  installSkillFromGithub: vi.fn(),
}))
vi.mock("@/features/skills/api", () => ({
  installSkillFromGithub: skillsApiMocks.installSkillFromGithub,
}))

/** 工具与扩展页所需 key 的完整设置（baseSettings 已含 python 四个 key，本地补齐其余缺省值） */
const toolsExtensionsSettings: SystemSettings = {
  ...baseSettings,
  chatDynamicSkillRuntimeEnabled: false,
  agentMaxToolIterations: 4,
  titleSummaryEnabled: false,
  titleSummaryMaxLength: 20,
  titleSummaryModelSource: "current",
}

const baseStatus: PythonRuntimeStatus = {
  dataRoot: "/app/data",
  runtimeRoot: "/app/data/python-runtime",
  venvPath: "/app/data/python-runtime/venv",
  pythonPath: "/app/data/python-runtime/venv/bin/python",
  ready: true,
  indexes: {
    indexUrl: "https://pypi.org/simple",
    extraIndexUrls: ["https://mirror.example/simple"],
    trustedHosts: ["mirror.example"],
    autoInstallOnActivate: true,
    autoInstallOnMissing: true,
  },
  manualPackages: ["numpy"],
  installedPackages: [
    { name: "numpy", version: "2.1.0" },
    { name: "pandas", version: "2.2.2" },
  ],
  packageSources: [
    { name: "numpy", sources: ["manual", "skill_manifest"] },
    { name: "pandas", sources: ["skill_auto"] },
  ],
  activeDependencies: [
    {
      skillId: 1,
      skillSlug: "data-agent",
      skillDisplayName: "Data Agent",
      versionId: 2,
      version: "1.0.0",
      requirement: "numpy==2.1.0",
      packageName: "numpy",
    },
  ],
  conflicts: [
    {
      packageName: "numpy",
      requirements: ["numpy==2.1.0", "numpy>=2.0,<2.2"],
      skills: [],
    },
  ],
}

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<SystemSettings>], Promise<void>>(() => Promise.resolve())

/** 运行时状态加载使用可手动 resolve 的 deferred，避免异步 setState 脱离 act */
let resolveRuntimeStatus: (value: { data: PythonRuntimeStatus }) => void = () => {}

const mockSystemSettings = (
  settings: SystemSettings | null,
  extras: Partial<{ isLoading: boolean; error: string | null }> = {},
) => {
  useSystemSettingsMock.mockReturnValue({
    settings,
    isLoading: false,
    error: null,
    refresh: refreshSpy,
    update: updateSpy,
    clearError: vi.fn(),
    ...extras,
  })
}

/** 通过卡片标题定位 FeatureCard 的 <section> 根节点 */
const getCard = (title: string) => {
  const heading = screen.getByText(title)
  const section = heading.closest("section")
  if (!section) throw new Error(`未找到卡片容器: ${title}`)
  return section as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  mockSystemSettings(toolsExtensionsSettings)
  runtimeApiMocks.getPythonRuntimeStatus.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRuntimeStatus = resolve
      }),
  )
  runtimeApiMocks.updatePythonRuntimeIndexes.mockResolvedValue({ data: {} })
  runtimeApiMocks.installPythonRuntimeRequirements.mockResolvedValue({ data: {} })
  runtimeApiMocks.uninstallPythonRuntimePackages.mockResolvedValue({ data: {} })
  runtimeApiMocks.reconcilePythonRuntime.mockResolvedValue({ data: {} })
  skillsApiMocks.installSkillFromGithub.mockResolvedValue({ success: true, data: {} })
})

afterEach(() => {
  cleanup()
})

describe("ToolsExtensionsPage", () => {
  test("渲染五张功能卡：Python 工具 / Python 运行时管理 / Skill 安装 / 模型大乱斗 / 标题智能总结", () => {
    render(<ToolsExtensionsPage />)
    expect(screen.getByText("工具与扩展")).toBeInTheDocument()
    expect(screen.getByText("Python 工具")).toBeInTheDocument()
    expect(screen.getByText("Python 运行时管理")).toBeInTheDocument()
    // FeatureCard 标题唯一（SkillInstallSection 内部标题已随单消费者收口移除）
    expect(screen.getAllByText("Skill 安装").length).toBeGreaterThan(0)
    expect(screen.getByText("模型大乱斗")).toBeInTheDocument()
    expect(screen.getByText("标题智能总结")).toBeInTheDocument()
    // Python 卡主开关
    expect(screen.getByRole("switch", { name: "启用Python 工具" })).toBeInTheDocument()
  })

  test("Python 卡保存 payload 精确等于 6 个 key；主开关关闭时 pythonToolEnable=false", async () => {
    render(<ToolsExtensionsPage />)
    const card = getCard("Python 工具")

    // 打开主开关 + 修改超时 → 保存
    await userEvent.click(screen.getByRole("switch", { name: "启用Python 工具" }))
    fireEvent.change(within(card).getByDisplayValue("8000"), { target: { value: "9000" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存 Python 工具设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({
      pythonToolEnable: true,
      chatDynamicSkillRuntimeEnabled: false,
      pythonToolTimeoutMs: 9000,
      pythonToolMaxOutputChars: 4000,
      pythonToolMaxSourceChars: 4000,
      agentMaxToolIterations: 4,
    })

    // 主开关关闭 → 保存，payload 中 pythonToolEnable=false（且仍精确 6 key）
    mockSystemSettings({ ...toolsExtensionsSettings, pythonToolEnable: true })
    updateSpy.mockClear()
    cleanup()
    render(<ToolsExtensionsPage />)
    await userEvent.click(screen.getByRole("switch", { name: "启用Python 工具" }))
    await userEvent.click(screen.getByRole("button", { name: "保存 Python 工具设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(
      [
        "pythonToolEnable",
        "chatDynamicSkillRuntimeEnabled",
        "pythonToolTimeoutMs",
        "pythonToolMaxOutputChars",
        "pythonToolMaxSourceChars",
        "agentMaxToolIterations",
      ].sort(),
    )
    expect(payload.pythonToolEnable).toBe(false)
  })

  test("Python 卡「更多参数」默认收起，点击展开后可见动态 Skill Runtime 与最大迭代次数", async () => {
    render(<ToolsExtensionsPage />)
    const card = getCard("Python 工具")

    expect(within(card).queryByText("启用聊天侧第三方动态 Skill Runtime")).not.toBeInTheDocument()
    expect(within(card).queryByText("Agent 工具最大迭代次数（0 表示无限制）")).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))

    expect(within(card).getByText("启用聊天侧第三方动态 Skill Runtime")).toBeInTheDocument()
    expect(within(card).getByText("Agent 工具最大迭代次数（0 表示无限制）")).toBeInTheDocument()
  })

  test("Python 运行时管理默认收起（索引配置不可见），点击展开后可见「保存索引配置」按钮", async () => {
    render(<ToolsExtensionsPage />)
    const card = getCard("Python 运行时管理")

    expect(within(card).queryByText("索引配置")).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))

    await act(async () => {
      resolveRuntimeStatus({ data: baseStatus })
    })

    await waitFor(() => {
      expect(within(card).getByText("保存索引配置")).toBeInTheDocument()
    })
    expect(within(card).getByText("已安装包（前 200 项）")).toBeInTheDocument()
  })

  test("乱斗卡保存 payload 包含 4 个 battle* key；非法值（-1）阻止保存并 toast", async () => {
    render(<ToolsExtensionsPage />)
    const card = getCard("模型大乱斗")

    // 合法保存
    fireEvent.change(within(card).getByDisplayValue("8"), { target: { value: "12" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存乱斗设置" }))
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({
      battleAllowAnonymous: true,
      battleAllowUsers: true,
      battleAnonymousDailyQuota: 12,
      battleUserDailyQuota: 40,
    })

    // 非法值 -1 阻止保存
    updateSpy.mockClear()
    toastSpy.mockClear()
    fireEvent.change(within(card).getByDisplayValue("12"), { target: { value: "-1" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存乱斗设置" }))
    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "输入无效", variant: "destructive" }),
    )
  })

  test("标题卡保存 payload 包含 3 个 titleSummary* key", async () => {
    render(<ToolsExtensionsPage />)
    const card = getCard("标题智能总结")

    // 开启智能标题（解锁长度输入与模型选择）
    await userEvent.click(within(card).getAllByRole("switch")[0])
    fireEvent.change(within(card).getByDisplayValue("20"), { target: { value: "30" } })
    await userEvent.click(within(card).getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "指定模型（暂不支持）" }))

    await userEvent.click(within(card).getByRole("button", { name: "保存标题总结设置" }))
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual({
      titleSummaryEnabled: true,
      titleSummaryMaxLength: 30,
      titleSummaryModelSource: "specified",
    })
  })

  test("settings 为 null 且 isLoading 时显示加载骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<ToolsExtensionsPage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByText("Python 工具")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "保存乱斗设置" })).not.toBeInTheDocument()
  })

  test("修改后点「还原更改」，保存按钮回到 disabled（dirty 跟踪行为）", async () => {
    render(<ToolsExtensionsPage />)
    const card = getCard("模型大乱斗")
    const saveButton = within(card).getByRole("button", { name: "保存乱斗设置" })

    expect(saveButton).toBeDisabled()

    fireEvent.change(within(card).getByDisplayValue("8"), { target: { value: "12" } })
    expect(saveButton).toBeEnabled()

    await userEvent.click(within(card).getByRole("button", { name: "还原更改" }))
    expect(saveButton).toBeDisabled()
    expect(within(card).getByDisplayValue("8")).toBeInTheDocument()
  })
})
