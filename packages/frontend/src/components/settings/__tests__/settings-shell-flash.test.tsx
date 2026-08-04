import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { SettingsShell } from "../shell"
import type { SettingsNavItem } from "../nav"

/** 3 级树：main → workspace → leaf，与真实系统设置同构 */
const threeLevelTree: SettingsNavItem[] = [
  {
    key: "system",
    label: "系统设置",
    children: [
      {
        key: "model-connections",
        label: "模型与连接",
        children: [
          { key: "connections", label: "供应商与连接" },
          { key: "models", label: "模型管理" },
        ],
      },
    ],
  },
]

type FlashTestProps = {
  flashKey?: string | null
  onFlashDone?: () => void
}

const renderShell = (props: FlashTestProps = {}) =>
  render(
    <SettingsShell
      mode="nested"
      tree={threeLevelTree}
      activeMain="system"
      activeSub="connections"
      onChangeMain={vi.fn()}
      onChangeSub={vi.fn()}
      flashKey={null}
      onFlashDone={vi.fn()}
      {...props}
    >
      <div>content</div>
    </SettingsShell>
  )

const scrollIntoViewSpy = vi.fn()

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoViewSpy
})

afterEach(() => {
  cleanup()
  scrollIntoViewSpy.mockClear()
})

describe("SettingsShell 导航闪烁（flashKey）", () => {
  test("flashKey 指向叶子时：展开所属分组、目标按钮获得 .settings-flash 并滚动到可见", async () => {
    renderShell({ flashKey: "models" })

    // 目标叶子按钮出现（分组被展开）并带闪烁 class
    const button = screen.getByRole("button", { name: "模型管理" })
    await waitFor(() => expect(button.classList.contains("settings-flash")).toBe(true))
    expect(scrollIntoViewSpy).toHaveBeenCalled()
  })

  test("flashKey 为 null 时目标按钮不闪烁", () => {
    renderShell({ flashKey: null })
    const button = screen.getByRole("button", { name: "模型管理" })
    expect(button.classList.contains("settings-flash")).toBe(false)
  })

  test("flashKey 对应的叶子不在树中时不报错、不闪烁任何项", async () => {
    renderShell({ flashKey: "nonexistent" })
    const button = screen.getByRole("button", { name: "模型管理" })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(button.classList.contains("settings-flash")).toBe(false)
  })

  test("flashKey 不在树中时兜底触发 onFlashDone（避免宿主状态残留）", async () => {
    const onFlashDone = vi.fn()
    renderShell({ flashKey: "nonexistent", onFlashDone })
    await waitFor(() => expect(onFlashDone).toHaveBeenCalledTimes(1))
  })

  test("prefers-reduced-motion 时跳过闪烁动画、直接触发 onFlashDone", async () => {
    const matchMediaSpy = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: true } as MediaQueryList)
    const onFlashDone = vi.fn()
    renderShell({ flashKey: "models", onFlashDone })

    const button = screen.getByRole("button", { name: "模型管理" })
    await waitFor(() => expect(onFlashDone).toHaveBeenCalledTimes(1))
    expect(button.classList.contains("settings-flash")).toBe(false)
    expect(scrollIntoViewSpy).toHaveBeenCalled()
    matchMediaSpy.mockRestore()
  })

  test("动画结束后触发 onFlashDone（animationend 一次性监听）", async () => {
    const onFlashDone = vi.fn()
    renderShell({ flashKey: "models", onFlashDone })

    const button = screen.getByRole("button", { name: "模型管理" })
    await waitFor(() => expect(button.classList.contains("settings-flash")).toBe(true))
    fireEvent.animationEnd(button)
    expect(onFlashDone).toHaveBeenCalledTimes(1)
  })

  test("连续两次不同 flashKey：过期动画的 animationend 不误触发新 onFlashDone", async () => {
    const onFlashDone = vi.fn()
    const { rerender } = renderShell({ flashKey: "models", onFlashDone })

    const button = screen.getByRole("button", { name: "模型管理" })
    await waitFor(() => expect(button.classList.contains("settings-flash")).toBe(true))

    // 切到新叶子：旧监听应在 cleanup 时移除
    rerender(
      <SettingsShell
        mode="nested"
        tree={threeLevelTree}
        activeMain="system"
        activeSub="models"
        onChangeMain={vi.fn()}
        onChangeSub={vi.fn()}
        flashKey="connections"
        onFlashDone={onFlashDone}
      >
        <div>content</div>
      </SettingsShell>
    )
    const newButton = screen.getByRole("button", { name: "供应商与连接" })
    await waitFor(() => expect(newButton.classList.contains("settings-flash")).toBe(true))

    // 旧按钮触发 animationend 不应调用 onFlashDone（监听已移除）
    fireEvent.animationEnd(button)
    expect(onFlashDone).not.toHaveBeenCalled()
  })
})
