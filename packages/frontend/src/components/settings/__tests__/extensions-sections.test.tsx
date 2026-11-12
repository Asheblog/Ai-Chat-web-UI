import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { OverviewSection } from "../pages/extensions/sections/overview-section"
import { McpSection, type McpSegment } from "../pages/extensions/sections/mcp-section"
import { ToolsSection } from "../pages/extensions/sections/tools-section"
import { ExtraSection } from "../pages/extensions/sections/extra-section"
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

/**
 * 总览段单测：三路数据（系统设置 / Skill 待审批 / MCP 连接）全部 mock，
 * 覆盖跨类型状态徽标、待处理行、失败降级与入口跳转。
 */

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const skillsApiMocks = vi.hoisted(() => ({ listSkillApprovals: vi.fn() }))
vi.mock("@/features/skills/api", () => ({
  listSkillApprovals: skillsApiMocks.listSkillApprovals,
}))

const mcpApiMocks = vi.hoisted(() => ({ listConnections: vi.fn() }))
vi.mock("@/features/mcp/api", () => ({
  listConnections: mcpApiMocks.listConnections,
}))

/** 内置工具段的 Python 运行时卡一挂载就拉 /api/python-runtime：给空状态，避免真实请求。 */
const pythonRuntimeApiMocks = vi.hoisted(() => ({ getPythonRuntimeStatus: vi.fn() }))
vi.mock("@/features/settings/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPythonRuntimeStatus: pythonRuntimeApiMocks.getPythonRuntimeStatus,
}))

/** 乱斗卡的非法值提示要断言：toast 换成 spy，不渲染 Toaster。 */
const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

/**
 * 5 个既有 tab 组件背后各是一整组 mcp / secret-vault 请求。
 * 段级用例只关心标签、卡 key 与开关，用 stub 替换，避免连带 mock 三层 API。
 */
vi.mock("@/components/settings/system-mcp/installations-tab", () => ({
  InstallationsTab: () => <p>安装模板面板</p>,
}))
vi.mock("@/components/settings/system-mcp/connections-tab", () => ({
  ConnectionsTab: () => <p>连接面板</p>,
}))
vi.mock("@/components/settings/system-mcp/secrets-tab", () => ({
  SecretsTab: () => <p>凭据面板</p>,
}))
vi.mock("@/components/settings/system-mcp/tools-tab", () => ({
  ToolsTab: () => <p>工具面板</p>,
}))
vi.mock("@/components/settings/system-mcp/bindings-tab", () => ({
  BindingsTab: () => <p>绑定面板</p>,
}))

const refreshSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())

const allEnabled = {
  mcpGlobalEnabled: true,
  chatDynamicSkillRuntimeEnabled: true,
  pythonToolEnable: true,
}

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

/** 内置工具 / 对话增强两段共用：补齐 python、乱斗、标题卡的 key（baseSettings 已含 python 与 battle 四项）。 */
const toolsAndExtrasSettings = { ...baseSettings, chatDynamicSkillRuntimeEnabled: false }

/** 空运行时状态：本文件只关心段布局与保存 payload，不渲染真实包清单。 */
const emptyRuntimeStatus = {
  dataRoot: "/app/data",
  runtimeRoot: "/app/data/python-runtime",
  venvPath: "/app/data/python-runtime/venv",
  pythonPath: "/app/data/python-runtime/venv/bin/python",
  ready: true,
  indexes: {
    indexUrl: "",
    extraIndexUrls: [],
    trustedHosts: [],
    autoInstallOnActivate: true,
    autoInstallOnMissing: true,
  },
  manualPackages: [],
  installedPackages: [],
  packageSources: [],
  activeDependencies: [],
  conflicts: [],
}

const onNavigate = vi.fn<(section: string, segment?: string) => void>()

/** 待处理行是 li：用例统一靠文案定位，再在行内取按钮，避免与卡片上的「进入」混淆。 */
async function rowOf(text: string): Promise<HTMLElement> {
  const node = await screen.findByText(text)
  const row = node.closest("li")
  if (!row) throw new Error(`未找到待处理行: ${text}`)
  return row as HTMLElement
}

function cardOf(name: string): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("section")
  if (!card) throw new Error(`未找到能力卡: ${name}`)
  return card as HTMLElement
}

beforeEach(() => {
  vi.resetAllMocks()
  refreshSpy.mockReturnValue(Promise.resolve())
  mockSettings(allEnabled)
  skillsApiMocks.listSkillApprovals.mockResolvedValue({ success: true, data: [] })
  mcpApiMocks.listConnections.mockResolvedValue({ success: true, data: [] })
  pythonRuntimeApiMocks.getPythonRuntimeStatus.mockResolvedValue({ data: emptyRuntimeStatus })
  updateSpy.mockReturnValue(Promise.resolve())
})

afterEach(() => {
  cleanup()
})

describe("总览段：三张能力卡", () => {
  test("渲染 MCP 服务 / Skill / 内置工具 三卡与状态徽标，且不放 Switch、根节点不带 data-section", async () => {
    mockSettings({ mcpGlobalEnabled: false, chatDynamicSkillRuntimeEnabled: true, pythonToolEnable: true })

    const { container } = render(<OverviewSection onNavigate={onNavigate} />)

    expect(screen.getByRole("heading", { name: "MCP 服务" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Skill" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "内置工具" })).toBeInTheDocument()

    // 总开关只归各段：总览只读状态，不放 Switch
    expect(container.querySelector('[role="switch"]')).toBeNull()
    // 页面根已带 data-section，段组件根节点不得重复
    expect(container.querySelector("[data-section]")).toBeNull()

    expect(screen.getByText("已关闭")).toBeInTheDocument() // mcpGlobalEnabled: false
    expect(screen.getByText("运行时已开")).toBeInTheDocument() // chatDynamicSkillRuntimeEnabled: true
    expect(screen.getByText("已启用")).toBeInTheDocument() // pythonToolEnable: true

    expect(screen.getByText("连接外部工具与数据源")).toBeInTheDocument()
    expect(screen.getByText("安装、审批与绑定第三方 Skill")).toBeInTheDocument()
    expect(screen.getByText("让模型在沙箱里执行 Python")).toBeInTheDocument()

    // 等两路统计落地，避免异步更新脱离 act
    expect(await screen.findByText("0 个连接")).toBeInTheDocument()
    expect(await screen.findByText("没有待审批的调用")).toBeInTheDocument()
  })

  test("settings 为 null 时显示骨架并只触发一次 refresh，卡片不消失", async () => {
    refreshSpy.mockReturnValue(new Promise<void>(() => {}))
    mockSettings(null)

    const { container } = render(<OverviewSection onNavigate={onNavigate} />)

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
    expect(screen.getByRole("heading", { name: "MCP 服务" })).toBeInTheDocument()
    expect(refreshSpy).toHaveBeenCalledTimes(1)

    // 统计与设置相互独立：设置还在加载时，待处理行照常给出结果
    expect(await screen.findByText("没有待审批的调用")).toBeInTheDocument()
  })
})

describe("总览段：待处理列表", () => {
  test("待审批 3 条：文案含「3 条」，点击「去处理」导航到 skills/approvals", async () => {
    skillsApiMocks.listSkillApprovals.mockResolvedValue({
      success: true,
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    const row = await rowOf("3 条 Skill 调用待审批")
    fireEvent.click(within(row).getByRole("button", { name: /去处理$/ }))

    expect(onNavigate).toHaveBeenCalledWith("skills", "approvals")
    // Skill 卡副信息同步显示待审批数，进入时直接落到待审批标签
    expect(screen.getByText("3 条待审批")).toBeInTheDocument()
    fireEvent.click(within(cardOf("Skill")).getByRole("button", { name: /^进入/ }))
    expect(onNavigate).toHaveBeenLastCalledWith("skills", "approvals")
  })

  test("未绑定凭据 2 条：文案含「2 个」，点击「去处理」导航到 mcp/connections", async () => {
    mcpApiMocks.listConnections.mockResolvedValue({
      success: true,
      data: [
        { id: 1, secretVaultId: null },
        { id: 2, secretVaultId: null },
        { id: 3, secretVaultId: 7 },
      ],
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    const row = await rowOf("2 个 MCP 连接未绑定凭据")
    fireEvent.click(within(row).getByRole("button", { name: /去处理$/ }))

    expect(onNavigate).toHaveBeenCalledWith("mcp", "connections")
    // 卡副信息统计的是全部连接数（含已绑定凭据的那条）
    expect(screen.getByText("3 个连接")).toBeInTheDocument()
  })

  test("待审批为 0 时显示「没有待审批的调用」且按钮禁用，Skill 卡进入落到 versions", async () => {
    render(<OverviewSection onNavigate={onNavigate} />)

    const row = await rowOf("没有待审批的调用")
    expect(within(row).getByRole("button", { name: /去处理$/ })).toBeDisabled()

    fireEvent.click(within(cardOf("Skill")).getByRole("button", { name: /^进入/ }))
    expect(onNavigate).toHaveBeenCalledWith("skills", "versions")
  })

  test("listSkillApprovals 失败：该行数量显示「—」、行尾「状态未知」、按钮禁用，其余内容照常渲染", async () => {
    skillsApiMocks.listSkillApprovals.mockRejectedValue(new Error("401"))
    mcpApiMocks.listConnections.mockResolvedValue({
      success: true,
      data: [{ id: 1, secretVaultId: null }],
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    const row = await rowOf("状态未知")
    expect(within(row).getByText("—")).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: /去处理$/ })).toBeDisabled()

    // 其余内容不受影响：另外两卡与另一行照常渲染
    expect(screen.getByRole("heading", { name: "内置工具" })).toBeInTheDocument()
    expect(screen.getByText("1 个 MCP 连接未绑定凭据")).toBeInTheDocument()
    expect(screen.getByText("— 条待审批")).toBeInTheDocument()
  })

  test("连接都已绑定凭据时显示 0 态文案且按钮禁用", async () => {
    mcpApiMocks.listConnections.mockResolvedValue({
      success: true,
      data: [{ id: 1, secretVaultId: 9 }],
    })

    render(<OverviewSection onNavigate={onNavigate} />)

    const row = await rowOf("连接都已绑定凭据")
    expect(within(row).getByRole("button", { name: /去处理$/ })).toBeDisabled()
  })

  test("listConnections 失败：MCP 行数量显示「—」、行尾「状态未知」、按钮禁用，卡副信息「— 个连接」", async () => {
    skillsApiMocks.listSkillApprovals.mockResolvedValue({ success: true, data: [] })
    mcpApiMocks.listConnections.mockRejectedValue(new Error("500"))

    render(<OverviewSection onNavigate={onNavigate} />)

    const row = await rowOf("MCP 连接未绑定凭据")
    expect(within(row).getByText("—")).toBeInTheDocument()
    expect(within(row).getByText("状态未知")).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: /去处理$/ })).toBeDisabled()
    expect(within(cardOf("MCP 服务")).getByText("— 个连接")).toBeInTheDocument()
  })
})

describe("总览段：入口跳转", () => {
  test("「进入」MCP 卡导航到 mcp 段", async () => {
    render(<OverviewSection onNavigate={onNavigate} />)

    fireEvent.click(within(cardOf("MCP 服务")).getByRole("button", { name: /^进入/ }))

    expect(onNavigate).toHaveBeenCalledWith("mcp")
    await screen.findByText("0 个连接")
  })

  test("其他增强两个入口都导航到 extra 段", async () => {
    render(<OverviewSection onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole("button", { name: "模型大乱斗" }))
    expect(onNavigate).toHaveBeenLastCalledWith("extra")

    fireEvent.click(screen.getByRole("button", { name: "标题智能总结" }))
    expect(onNavigate).toHaveBeenLastCalledWith("extra")
    await screen.findByText("0 个连接")
  })
})

/** MCP 段由页面持有次级标签状态：这里包一层受控外壳模拟 ExtensionsPage。 */
function McpHarness({ initialSegment }: { initialSegment?: McpSegment }) {
  const [segment, setSegment] = React.useState<McpSegment>(initialSegment ?? "installations")
  return <McpSection segment={segment} onSegmentChange={setSegment} />
}

/** 冲掉页头设置请求的 promise，避免异步 setState 脱离 act。 */
async function renderMcp(initialSegment?: McpSegment) {
  const view = render(<McpHarness initialSegment={initialSegment} />)
  await act(async () => {})
  return view
}

const GLOBAL_OFF_HINT = "MCP 全局已关闭，开启后才能连接与调用工具。"

describe("MCP 段：五标签与全局开关", () => {
  test("5 个次级标签顺序固定且不含「总览」，默认落安装模板并挂上卡 key", async () => {
    const { container } = await renderMcp()

    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
      "安装模板",
      "连接",
      "凭据",
      "工具",
      "绑定",
    ])
    expect(screen.queryByRole("tab", { name: "总览" })).toBeNull()

    expect(screen.getByRole("heading", { name: "MCP 服务" })).toBeInTheDocument()
    expect(screen.getByText("连接外部工具与数据源")).toBeInTheDocument()
    expect(screen.getByText("安装模板面板")).toBeInTheDocument()
    expect(container.querySelector('[data-card-key="extensions:mcp-installations"]')).not.toBeNull()
  })

  test("点「凭据」渲染凭据内容，容器 data-card-key 切到 extensions:mcp-secrets", async () => {
    const { container } = await renderMcp()

    fireEvent.click(screen.getByRole("tab", { name: "凭据" }))

    expect(screen.getByText("凭据面板")).toBeInTheDocument()
    expect(screen.queryByText("安装模板面板")).toBeNull()
    expect(container.querySelector('[data-card-key="extensions:mcp-secrets"]')).not.toBeNull()
    expect(container.querySelector('[data-card-key="extensions:mcp-installations"]')).toBeNull()
  })

  test("全局关闭时安装模板不提示，切到「连接」显示全局关闭提示", async () => {
    mockSettings({ ...allEnabled, mcpGlobalEnabled: false })

    await renderMcp()

    expect(screen.getByText("全局 已关闭")).toBeInTheDocument()
    expect(screen.queryByText(GLOBAL_OFF_HINT)).toBeNull()

    fireEvent.click(screen.getByRole("tab", { name: "连接" }))

    expect(screen.getByText("连接面板")).toBeInTheDocument()
    expect(screen.getByText(GLOBAL_OFF_HINT)).toBeInTheDocument()
  })

  test("设置读取失败时开关显示「状态未知」而非「已开启」，禁用并给重试与错误文案", async () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: "加载系统设置失败",
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    await renderMcp()

    expect(screen.getByText("全局 状态未知")).toBeInTheDocument()
    expect(screen.queryByText("全局 已开启")).toBeNull()
    expect(screen.getByRole("switch", { name: "全局 MCP 开关" })).toBeDisabled()
    expect(screen.getByText("加载系统设置失败")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
    // 状态未知时不得误报「全局已关闭」提示
    fireEvent.click(screen.getByRole("tab", { name: "连接" }))
    expect(screen.queryByText(GLOBAL_OFF_HINT)).toBeNull()
  })

  test("切换全局开关走共享 store，只写一次 { mcpGlobalEnabled: false }", async () => {
    await renderMcp()
    const toggle = screen.getByRole("switch", { name: "全局 MCP 开关" })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith({ mcpGlobalEnabled: false })
  })

  test("保存失败时开关仍显示 store 里的原值，不出现半更新状态", async () => {
    updateSpy.mockRejectedValueOnce(new Error("500"))
    await renderMcp()

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "全局 MCP 开关" }))
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(screen.getByText("全局 已开启")).toBeInTheDocument()
      expect(screen.getByRole("switch", { name: "全局 MCP 开关" })).toHaveAttribute(
        "aria-checked",
        "true",
      )
      expect(screen.queryByText("保存中...")).toBeNull()
    })
  })
})

/* ------------------------------ 内置工具段 / 对话增强段 ------------------------------ */

/** FeatureCard 的标题是 span（不是 heading），用它定位卡片的 <section> 根节点。 */
function featureCardOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest("section")
  if (!card) throw new Error(`未找到功能卡: ${title}`)
  return card as HTMLElement
}

describe("内置工具段：两卡与唯一控制点", () => {
  test("渲染 Python 工具与 Python 运行时管理两卡，卡 key 为 extensions:python-tools / extensions:python-runtime", async () => {
    mockSettings(toolsAndExtrasSettings)
    const { container } = render(<ToolsSection />)

    expect(screen.getByRole("heading", { name: "内置工具" })).toBeInTheDocument()
    expect(screen.getByText("让模型在沙箱里执行 Python 与受管依赖")).toBeInTheDocument()

    expect(featureCardOf("Python 工具")).toHaveAttribute(
      "data-card-key",
      "extensions:python-tools",
    )
    expect(featureCardOf("Python 运行时管理")).toHaveAttribute(
      "data-card-key",
      "extensions:python-runtime",
    )
    // 旧页的卡 key 不得残留，否则搜索定位会指向不存在的段
    expect(container.querySelector('[data-card-key^="tools-extensions:"]')).toBeNull()

    await act(async () => {}) // 冲掉运行时状态请求
  })

  test("「更多参数」只剩迭代上限，不再重复动态 Skill Runtime 开关（回归：双控制点）", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ToolsSection />)
    const card = featureCardOf("Python 工具")

    expect(within(card).queryByText(/动态 Skill Runtime/)).toBeNull()

    fireEvent.click(within(card).getByRole("button", { name: "更多参数" }))

    expect(within(card).getByText("Agent 工具最大迭代次数（0 表示无限制）")).toBeInTheDocument()
    expect(within(card).queryByText("启用聊天侧第三方动态 Skill Runtime")).toBeNull()
    // 该 key 的唯一控制点已归 Skill 段页头：本卡只保留主开关
    expect(within(card).queryAllByRole("switch")).toHaveLength(1)

    await act(async () => {})
  })

  test("改超时与 stdout 截断后保存，payload 精确等于 5 个 key（不再提交动态 Skill Runtime）", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ToolsSection />)
    const card = featureCardOf("Python 工具")

    fireEvent.click(screen.getByRole("switch", { name: "启用Python 工具" }))
    fireEvent.change(within(card).getByDisplayValue("8000"), { target: { value: "9000" } })
    // 两个 4000 分别是 stdout 截断与代码长度限制，前者在前
    const [stdoutInput] = within(card).getAllByDisplayValue("4000")
    fireEvent.change(stdoutInput, { target: { value: "5000" } })

    fireEvent.click(within(card).getByRole("button", { name: "保存 Python 工具设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      pythonToolEnable: true,
      pythonToolTimeoutMs: 9000,
      pythonToolMaxOutputChars: 5000,
      pythonToolMaxSourceChars: 4000,
      agentMaxToolIterations: 4,
    })
    expect(Object.keys(updateSpy.mock.calls[0][0]).sort()).toEqual(
      [
        "pythonToolEnable",
        "pythonToolTimeoutMs",
        "pythonToolMaxOutputChars",
        "pythonToolMaxSourceChars",
        "agentMaxToolIterations",
      ].sort(),
    )

    await act(async () => {})
  })

  test("主开关 true→false 后保存，payload 里 pythonToolEnable 为 false 且其余 key 不变", async () => {
    mockSettings({ ...toolsAndExtrasSettings, pythonToolEnable: true })
    render(<ToolsSection />)
    const card = featureCardOf("Python 工具")

    const toggle = screen.getByRole("switch", { name: "启用Python 工具" })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "false")
    fireEvent.click(within(card).getByRole("button", { name: "保存 Python 工具设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      pythonToolEnable: false,
      pythonToolTimeoutMs: 8000,
      pythonToolMaxOutputChars: 4000,
      pythonToolMaxSourceChars: 4000,
      agentMaxToolIterations: 4,
    })

    await act(async () => {}) // 冲掉运行时状态请求
  })
})

describe("对话增强段：两卡与保存", () => {
  test("渲染模型大乱斗与标题智能总结两卡，卡 key 为 extensions:battle / extensions:title-summary", () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)

    expect(screen.getByRole("heading", { name: "对话增强" })).toBeInTheDocument()
    expect(screen.getByText("模型大乱斗与标题智能总结")).toBeInTheDocument()

    expect(featureCardOf("模型大乱斗")).toHaveAttribute("data-card-key", "extensions:battle")
    expect(featureCardOf("标题智能总结")).toHaveAttribute(
      "data-card-key",
      "extensions:title-summary",
    )
  })

  test("乱斗每日次数填 -1 阻止保存并提示；改成合法值后按 4 个 battle* key 提交", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("模型大乱斗")

    fireEvent.change(within(card).getByDisplayValue("8"), { target: { value: "-1" } })
    fireEvent.click(within(card).getByRole("button", { name: "保存乱斗设置" }))

    expect(updateSpy).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "输入无效", variant: "destructive" }),
    )

    fireEvent.change(within(card).getByDisplayValue("-1"), { target: { value: "12" } })
    fireEvent.click(within(card).getByRole("button", { name: "保存乱斗设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      battleAllowAnonymous: true,
      battleAllowUsers: true,
      battleAnonymousDailyQuota: 12,
      battleUserDailyQuota: 40,
    })
  })

  test("标题总结开关保存 3 个 titleSummary* key", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("标题智能总结")
    const save = within(card).getByRole("button", { name: "保存标题总结设置" })
    expect(save).toBeDisabled()

    fireEvent.click(within(card).getAllByRole("switch")[0])
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      titleSummaryEnabled: true,
      titleSummaryMaxLength: 20,
      titleSummaryModelSource: "current",
    })
  })
})

describe("对话增强段：草稿链路", () => {
  test("标题总结：长度改 30 + 模型来源切到「指定模型（暂不支持）」后保存，payload 精确 3 个 key", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("标题智能总结")

    // 先开启智能标题：关闭态下长度输入与模型选择都是 disabled，改不动
    const titleSummaryEnabled = true
    fireEvent.click(within(card).getAllByRole("switch")[0])
    fireEvent.change(within(card).getByDisplayValue("20"), { target: { value: "30" } })

    await userEvent.click(within(card).getByRole("combobox"))
    await userEvent.click(await screen.findByRole("option", { name: "指定模型（暂不支持）" }))

    fireEvent.click(within(card).getByRole("button", { name: "保存标题总结设置" }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual({
      titleSummaryEnabled,
      titleSummaryMaxLength: 30,
      titleSummaryModelSource: "specified",
    })
  })

  test("乱斗：改每日次数后点「还原更改」，输入框回到 store 值且保存按钮重新禁用", async () => {
    mockSettings(toolsAndExtrasSettings)
    render(<ExtraSection />)
    const card = featureCardOf("模型大乱斗")
    const saveButton = within(card).getByRole("button", { name: "保存乱斗设置" })
    expect(saveButton).toBeDisabled()

    fireEvent.change(within(card).getByDisplayValue("8"), { target: { value: "12" } })
    expect(within(card).getByDisplayValue("12")).toBeInTheDocument()
    expect(saveButton).toBeEnabled()

    fireEvent.click(within(card).getByRole("button", { name: "还原更改" }))

    expect(within(card).getByDisplayValue("8")).toBeInTheDocument()
    expect(saveButton).toBeDisabled()
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe("两段的设置读取降级", () => {
  test("settings 为 null + error：两段都显示错误文案与「重试」，不渲染任何卡片", () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: "加载系统设置失败",
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    const { container } = render(
      <>
        <ToolsSection />
        <ExtraSection />
      </>,
    )

    expect(screen.getAllByText("加载系统设置失败")).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "重试" })).toHaveLength(2)
    expect(container.querySelector("[data-card-key]")).toBeNull()
    expect(screen.queryByText("Python 工具")).toBeNull()
    expect(screen.queryByText("模型大乱斗")).toBeNull()
    // 两段各自补拉一次，不因重渲染反复请求
    expect(refreshSpy).toHaveBeenCalledTimes(2)
  })

  test("settings 为 null 且尚无结果时给骨架，而不是「无法加载」的假错误", () => {
    useSystemSettingsMock.mockReturnValue({
      settings: null,
      isLoading: false,
      error: null,
      refresh: refreshSpy,
      update: updateSpy,
      clearError: vi.fn(),
    })

    const { container } = render(<ToolsSection />)

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText("无法加载系统设置")).toBeNull()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })
})

