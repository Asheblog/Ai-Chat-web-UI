import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SettingsDialog } from "../settings-dialog"

// 稳定引用：SettingsDialog 的初始化 effect 依赖 toast/useAuthStore 返回值，
// mock 若每次调用返回新引用会导致 effect 无限重跑（worker 崩溃）。
const { toastMock, authStateMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  authStateMock: { actorState: "authenticated", user: { role: "ADMIN" } },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  // 注意：真实 searchParams 是稳定引用；mock 若每次返回新对象，
  // Dialog 的初始化 effect 会随每次渲染重跑（依赖 searchParams），
  // 配合 act 同步 flush 会形成无限渲染，因此这里保持单例。
  useSearchParams: () => searchParamsMock,
}))

const { searchParamsMock } = vi.hoisted(() => ({ searchParamsMock: new URLSearchParams() }))

vi.mock("@/store/auth-store", () => ({
  useAuthStore: () => authStateMock,
}))

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/settings/system-settings-registry", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../system-settings-registry")>()
  return {
    ...mod,
    renderSystemLeaf: (key: string) => React.createElement("div", { "data-testid": `leaf-${key}` }, `leaf-${key}`),
  }
})

const dispatchSelect = (detail: { key: string; cardKey?: string; origin?: string }) => {
  window.dispatchEvent(new CustomEvent("aichat:system-settings-select", { detail }))
}

beforeEach(() => {
  window.localStorage.clear()
  // jsdom 未实现 scrollIntoView：搜索跳转闪烁（flashKey）路径需要 stub
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("SettingsDialog 搜索接入", () => {
  test("打开后侧边栏出现搜索框（navTop 接入）", () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} defaultTab="system" />)
    expect(screen.getByRole("textbox", { name: "搜索设置" })).toBeInTheDocument()
  })

  test("收到 select 事件（系统叶子）切换到对应叶子页", async () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} defaultTab="system" />)
    dispatchSelect({ key: "models", origin: "search" })
    await waitFor(() => expect(screen.getByTestId("leaf-models")).toBeInTheDocument())
  })

  test("搜索来源（origin=search）的 select 事件显示位置提示条「已定位到」", async () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} defaultTab="system" />)
    dispatchSelect({ key: "data-maintenance", cardKey: "data-maintenance:compression", origin: "search" })
    await waitFor(() => {
      const banner = screen.getByRole("status")
      expect(banner.textContent).toContain("已定位到：系统与数据 → 数据与维护 · 上下文压缩")
    })
  })

  test("导航点击来源（无 origin）的 select 事件不显示位置提示条", async () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} defaultTab="system" />)
    dispatchSelect({ key: "models" })
    await waitFor(() => expect(screen.getByTestId("leaf-models")).toBeInTheDocument())
    // 无 origin 不触发位置提醒
    expect(screen.queryByText(/已定位到/)).not.toBeInTheDocument()
  })

  test("Dialog 关闭时 select 事件不切页、不触发位置提醒（open 门控）", async () => {
    render(<SettingsDialog open={false} onOpenChange={vi.fn()} defaultTab="system" />)
    dispatchSelect({ key: "models", cardKey: "models:catalog", origin: "search" })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId("leaf-models")).not.toBeInTheDocument()
    expect(screen.queryByText(/已定位到/)).not.toBeInTheDocument()
  })
})
