import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { BrandingPage } from "@/components/settings/pages/branding/BrandingPage"
import { adminAuthState, baseSettings } from "./system-settings-pages.fixtures"

// jsdom 未实现 Pointer Capture API，Radix 组件依赖它
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

const useAuthStoreMock = vi.hoisted(() => vi.fn())
vi.mock("@/store/auth-store", () => ({
  useAuthStore: useAuthStoreMock,
}))

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const refreshImageAttachmentsMock = vi.hoisted(() => vi.fn())
vi.mock("@/features/settings/api", () => ({
  refreshImageAttachments: refreshImageAttachmentsMock,
}))

// 桩替换 AvatarUploadField：避免 jsdom 文件输入难点，
// 渲染「上传」「清除」两个按钮，分别触发 props 的 onUpload/onClear（固定值）。
vi.mock("@/components/settings/components/avatar-upload-field", () => ({
  AvatarUploadField: ({ onUpload, onClear }: any) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onUpload?.({
            data: "BASE64DATA",
            mime: "image/png",
            previewUrl: "data:image/png;base64,BASE64DATA",
          })
        }
      >
        上传
      </button>
      <button type="button" onClick={() => onClear?.()}>
        清除
      </button>
    </div>
  ),
}))

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<typeof baseSettings>], Promise<void>>(() => Promise.resolve())

const mockSystemSettings = (
  settings: typeof baseSettings | null,
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

const mockUseAuthStore = (state: typeof adminAuthState) => {
  useAuthStoreMock.mockImplementation((selector: any) => {
    if (typeof selector === "function") return selector(state)
    return state
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
  refreshImageAttachmentsMock.mockReset()
  refreshImageAttachmentsMock.mockResolvedValue({
    success: true,
    data: { baseUrl: "https://chat.example.com", attachments: 0, samples: [], refreshedAt: "" },
  })
  mockUseAuthStore(adminAuthState)
  mockSystemSettings(baseSettings)
})

afterEach(() => {
  cleanup()
})

describe("BrandingPage", () => {
  test("渲染页头 + 两卡标题（AI 头像/品牌定制）", () => {
    render(<BrandingPage />)

    expect(screen.getByText("品牌与界面")).toBeInTheDocument()
    expect(screen.getByText("AI 头像、品牌标识与站点信息")).toBeInTheDocument()
    expect(screen.getByText("AI 头像")).toBeInTheDocument()
    expect(screen.getByText("设置全局生效的 AI 回复头像")).toBeInTheDocument()
    expect(screen.getByText("品牌定制")).toBeInTheDocument()
    expect(screen.getByText("自定义系统的品牌标识和外观")).toBeInTheDocument()
    // 三行设置项
    expect(screen.getByText("文字 LOGO")).toBeInTheDocument()
    expect(screen.getByText("全局系统提示词")).toBeInTheDocument()
    expect(screen.getByText("图片访问域名")).toBeInTheDocument()
  })

  test("品牌卡保存 payload 精确等于 3 个 key，siteBaseUrl 被 trim", async () => {
    render(<BrandingPage />)
    const card = getCard("品牌定制")

    fireEvent.change(within(card).getByDisplayValue("AIChat"), { target: { value: "MyBrand" } })
    fireEvent.change(within(card).getByDisplayValue("https://chat.example.com"), {
      target: { value: "https://chat.example.com   " },
    })
    await userEvent.click(within(card).getByRole("button", { name: "保存品牌设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(["brandText", "chatSystemPrompt", "siteBaseUrl"].sort())
    expect(payload).toEqual({
      brandText: "MyBrand",
      chatSystemPrompt: "",
      siteBaseUrl: "https://chat.example.com",
    })
  })

  test("dirty：修改后保存启用；还原原值后 disabled", async () => {
    render(<BrandingPage />)
    const card = getCard("品牌定制")
    const saveButton = within(card).getByRole("button", { name: "保存品牌设置" })

    expect(saveButton).toBeDisabled()

    fireEvent.change(within(card).getByDisplayValue("AIChat"), { target: { value: "MyBrand" } })
    expect(saveButton).toBeEnabled()

    fireEvent.change(within(card).getByDisplayValue("MyBrand"), { target: { value: "AIChat" } })
    expect(saveButton).toBeDisabled()
  })

  test("点击「上传」→ update 被调 with { assistantAvatarUpload: { data, mime } }", async () => {
    render(<BrandingPage />)
    const card = getCard("AI 头像")

    await userEvent.click(within(card).getByRole("button", { name: "上传" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy).toHaveBeenCalledWith({
      assistantAvatarUpload: { data: "BASE64DATA", mime: "image/png" },
    })
  })

  test("点击「清除」→ update 被调 with { assistantAvatarRemove: true }", async () => {
    render(<BrandingPage />)
    const card = getCard("AI 头像")

    await userEvent.click(within(card).getByRole("button", { name: "清除" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy).toHaveBeenCalledWith({ assistantAvatarRemove: true })
  })

  test("刷新按钮 → refreshImageAttachments 被调", async () => {
    render(<BrandingPage />)
    const card = getCard("品牌定制")

    await userEvent.click(within(card).getByRole("button", { name: "刷新" }))

    await waitFor(() => {
      expect(refreshImageAttachmentsMock).toHaveBeenCalledTimes(1)
    })
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "刷新成功" }))
  })

  test("settings 加载中渲染骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<BrandingPage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "保存品牌设置" })).not.toBeInTheDocument()
    expect(screen.queryByText("品牌定制")).not.toBeInTheDocument()
  })
})
