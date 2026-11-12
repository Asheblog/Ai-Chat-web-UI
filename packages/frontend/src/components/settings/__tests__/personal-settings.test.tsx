import React from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { PersonalSettings } from "@/components/personal-settings"
import { McpSection } from "@/components/settings/pages/extensions/sections/mcp-section"

// jsdom 未实现 Pointer Capture API（Radix Select / Dropdown 交互依赖）
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

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
}))

const settingsStoreMock = vi.hoisted(() => ({
  contextEnabled: true,
  newConversationContextEnabled: false,
  setContextEnabled: vi.fn(),
  setNewConversationContextEnabled: vi.fn(),
  // McpSection 的全局开关走 useSystemSettings（共享 store）
  systemSettings: null,
  isLoading: false,
  error: null,
  fetchSystemSettings: vi.fn(() => Promise.resolve()),
  updateSystemSettings: vi.fn(() => Promise.resolve()),
  clearError: vi.fn(),
}))
vi.mock("@/store/settings-store", () => ({
  useSettingsStore: () => settingsStoreMock,
}))

const authState = vi.hoisted(() => ({
  user: { username: "tester", avatarUrl: null, personalPrompt: null },
  actorState: "authenticated",
  fetchActor: vi.fn(),
}))
vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: any) =>
    typeof selector === "function" ? selector(authState) : authState,
}))

const settingsApiMocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
  updatePersonalSettings: vi.fn(),
}))
vi.mock("@/features/settings/api", () => ({
  getSystemSettings: settingsApiMocks.getSystemSettings,
  updateSystemSettings: settingsApiMocks.updateSystemSettings,
  updatePersonalSettings: settingsApiMocks.updatePersonalSettings,
}))

/**
 * MCP 页壳已并入能力扩展页：本文件只剩一条页头副标题断言，
 * 它渲染的 McpSection 默认落「安装模板」标签，会拉安装模板与凭据列表，一并 mock。
 */
const mcpApiMocks = vi.hoisted(() => ({ listInstallations: vi.fn() }))
vi.mock("@/features/mcp/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listInstallations: mcpApiMocks.listInstallations,
}))

const secretVaultMocks = vi.hoisted(() => ({ listSecrets: vi.fn() }))
vi.mock("@/features/secret-vault/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listSecrets: secretVaultMocks.listSecrets,
}))

const shareApiMocks = vi.hoisted(() => ({
  listChatShares: vi.fn(),
  revokeChatShare: vi.fn(),
  updateChatShare: vi.fn(),
}))
vi.mock("@/features/share/api", () => ({
  listChatShares: shareApiMocks.listChatShares,
  revokeChatShare: shareApiMocks.revokeChatShare,
  updateChatShare: shareApiMocks.updateChatShare,
}))

const skillsApiMocks = vi.hoisted(() => ({
  listSkillStore: vi.fn(),
  listSkillCatalog: vi.fn(),
  installSkillFromStore: vi.fn(),
  deleteSkill: vi.fn(),
}))
vi.mock("@/features/skills/api", () => ({
  listSkillStore: skillsApiMocks.listSkillStore,
  listSkillCatalog: skillsApiMocks.listSkillCatalog,
  installSkillFromStore: skillsApiMocks.installSkillFromStore,
  deleteSkill: skillsApiMocks.deleteSkill,
}))

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  settingsApiMocks.getSystemSettings.mockResolvedValue({ data: { mcpGlobalEnabled: true } })
  settingsApiMocks.updateSystemSettings.mockResolvedValue({ success: true })
  settingsApiMocks.updatePersonalSettings.mockResolvedValue({ success: true })
  shareApiMocks.listChatShares.mockResolvedValue({ success: true, data: { shares: [] } })
  skillsApiMocks.listSkillStore.mockResolvedValue({ success: true, data: { items: [], sources: [] } })
  skillsApiMocks.listSkillCatalog.mockResolvedValue({ success: true, data: [] })
  mcpApiMocks.listInstallations.mockResolvedValue({ success: true, data: [] })
  secretVaultMocks.listSecrets.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
})

/** 冲刷组件挂载后由 mock Promise 驱动的状态更新 */
const flushAsync = async () => {
  await act(async () => {})
}

describe("PersonalSettings 个人设置分区", () => {
  // 旧行为是四个分区同时挂载；性能修复后只挂载当前激活页，
  // 锚点与数据请求的独立覆盖见 personal-settings-section.test.tsx。
  test("默认只渲染 profile 激活页", async () => {
    const { container } = render(<PersonalSettings />)
    await screen.findByText("管理你的头像、用户名与界面主题")

    expect(container.querySelector("#settings-personal-preferences")).not.toBeNull()
    expect(container.querySelector("#settings-share-management")).toBeNull()
    expect(screen.queryByText("最近分享")).not.toBeInTheDocument()
  })

  // MCP 页壳已收进能力扩展页的 MCP 段，副标题断言随组件一起搬过来；
  // 段头文案现在唯一来源是 EXTENSION_SECTIONS，这里断言的正是段配置里那一句。
  test("MCP 段页头副标题来自段配置", async () => {
    render(<McpSection segment="installations" onSegmentChange={() => {}} />)
    await flushAsync()
    await screen.findByRole("heading", { name: "MCP 服务" })

    expect(screen.getByText(/MCP 服务模板、连接、凭据、工具与绑定作用域/)).toBeInTheDocument()
  })
})
