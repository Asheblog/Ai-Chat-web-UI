import React from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { PersonalSettings } from "@/components/personal-settings"
import { SystemMcpPage } from "@/components/settings/pages/SystemMcpPage"

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

  test("MCP 页头副标题可见（已有，保持不变）", async () => {
    render(<SystemMcpPage />)
    await screen.findByText("MCP 管理")

    expect(screen.getByText(/连接外部工具与数据源/)).toBeInTheDocument()
  })
})
