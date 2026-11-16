import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SessionDefaultsPage } from "@/components/settings/pages/session-defaults/SessionDefaultsPage"
import { adminAuthState, baseSettings } from "./system-settings-pages.fixtures"

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

const refreshSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<(arg: Partial<typeof baseSettings>) => Promise<void>>(() => Promise.resolve())

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

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  useAuthStoreMock.mockImplementation((selector: any) =>
    typeof selector === "function" ? selector(adminAuthState) : adminAuthState,
  )
  mockSystemSettings({ ...baseSettings, chatSystemPrompt: "你是助教" })
})

afterEach(() => {
  cleanup()
})

describe("SessionDefaultsPage（连接与模型 → 会话默认配置）", () => {
  test("渲染页头与全局系统提示词卡，生效顺序与后端一致（个人偏好为追加层）", () => {
    render(<SessionDefaultsPage />)

    expect(screen.getByText("会话默认配置")).toBeInTheDocument()
    // 页头副标题与卡副标题都必须表达「基础提示词 = 会话 > 全局 > 内置默认；个人偏好追加」
    expect(screen.getByText("所有会话共用的基础提示词；会话可以覆盖它，个人偏好作为追加层")).toBeInTheDocument()
    expect(screen.getByText("所有会话的基础提示词：会话 > 全局 > 内置默认；个人偏好独立追加")).toBeInTheDocument()
    expect(screen.getByText("全局系统提示词")).toBeInTheDocument()
    expect(screen.getByDisplayValue("你是助教")).toBeInTheDocument()
    expect(screen.getByText(/个人偏好作为独立内容追加，不会顶掉这三层/)).toBeInTheDocument()
  })

  test("保存只提交 chatSystemPrompt", async () => {
    render(<SessionDefaultsPage />)
    const card = screen.getByText("全局系统提示词").closest("section") as HTMLElement

    fireEvent.change(within(card).getByDisplayValue("你是助教"), { target: { value: "新的全局提示词" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存提示词" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy).toHaveBeenCalledWith({ chatSystemPrompt: "新的全局提示词" })
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "已保存全局系统提示词" }))
  })

  test("未改动时保存按钮 disabled", () => {
    render(<SessionDefaultsPage />)
    expect(screen.getByRole("button", { name: "保存提示词" })).toBeDisabled()
  })

  test("保存失败 → toast 失败文案并保留输入", async () => {
    updateSpy.mockRejectedValueOnce(new Error("权限不足"))
    render(<SessionDefaultsPage />)
    const card = screen.getByText("全局系统提示词").closest("section") as HTMLElement

    fireEvent.change(within(card).getByDisplayValue("你是助教"), { target: { value: "保留这段" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存提示词" }))

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "保存失败", description: "权限不足", variant: "destructive" }),
      )
    })
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "已保存全局系统提示词" }))
    expect(within(card).getByDisplayValue("保留这段")).toBeInTheDocument()
  })

  test("settings 加载中渲染骨架", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<SessionDefaultsPage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByText("全局系统提示词")).not.toBeInTheDocument()
  })

  test("settings 读取失败 → 错误文案与重试", () => {
    mockSystemSettings(null, { isLoading: false, error: "获取系统设置失败" })
    render(<SessionDefaultsPage />)

    expect(screen.getByText("获取系统设置失败")).toBeInTheDocument()

    refreshSpy.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })
})
