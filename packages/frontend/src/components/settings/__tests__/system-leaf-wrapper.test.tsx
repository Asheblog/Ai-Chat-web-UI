import React from "react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SystemLeafWrapper } from "../system-leaf-wrapper"
import { consumeFlash, requestFlash } from "../settings-flash-bus"

const scrollIntoViewSpy = vi.fn()

const cardSection = (cardKey: string, label: string) => (
  <section data-card-key={cardKey}>{label}</section>
)

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoViewSpy
})

afterEach(() => {
  cleanup()
  consumeFlash()
  scrollIntoViewSpy.mockClear()
})

const dispatchFlashEvent = (detail: { leafKey: string; cardKey?: string; hostId?: string }) => {
  act(() => {
    window.dispatchEvent(new CustomEvent("aichat:settings-flash-card", { detail }))
  })
}

describe("SystemLeafWrapper 卡定位", () => {
  test("挂载时消费 flash-bus 的 lastRequest：目标卡 .settings-flash + 滚动，非目标卡不受影响", async () => {
    requestFlash({ leafKey: "data-maintenance", cardKey: "data-maintenance:compression" })

    render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div>
          {cardSection("data-maintenance:compression", "上下文压缩")}
          {cardSection("data-maintenance:retention", "数据保留策略")}
        </div>
      </SystemLeafWrapper>
    )

    const target = document.querySelector('[data-card-key="data-maintenance:compression"]')!
    const other = document.querySelector('[data-card-key="data-maintenance:retention"]')!
    await waitFor(() => expect(target.classList.contains("settings-flash")).toBe(true))
    expect(scrollIntoViewSpy).toHaveBeenCalled()
    expect(other.classList.contains("settings-flash")).toBe(false)
  })

  test("挂载后收到 aichat:settings-flash-card 事件也能定位（同页热更新场景）", async () => {
    render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div>{cardSection("data-maintenance:task-trace", "任务追踪")}</div>
      </SystemLeafWrapper>
    )

    dispatchFlashEvent({ leafKey: "data-maintenance", cardKey: "data-maintenance:task-trace" })

    const target = document.querySelector('[data-card-key="data-maintenance:task-trace"]')!
    await waitFor(() => expect(target.classList.contains("settings-flash")).toBe(true))
  })

  test("请求属于其他叶子页时被忽略", async () => {
    requestFlash({ leafKey: "branding", cardKey: "branding:avatar" })

    render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div>{cardSection("data-maintenance:retention", "数据保留策略")}</div>
      </SystemLeafWrapper>
    )

    await new Promise((resolve) => setTimeout(resolve, 80))
    const target = document.querySelector('[data-card-key="data-maintenance:retention"]')!
    expect(target.classList.contains("settings-flash")).toBe(false)
  })

  test("宿主不匹配的请求被忽略（Dialog 请求不闪布局页的卡）", async () => {
    requestFlash({ leafKey: "data-maintenance", cardKey: "data-maintenance:compression", hostId: "dialog" })

    render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div>{cardSection("data-maintenance:compression", "上下文压缩")}</div>
      </SystemLeafWrapper>
    )

    await new Promise((resolve) => setTimeout(resolve, 80))
    const target = document.querySelector('[data-card-key="data-maintenance:compression"]')!
    expect(target.classList.contains("settings-flash")).toBe(false)
    // 请求未被消费，仍可由 dialog 宿主的 wrapper 兜底
    expect(consumeFlash("data-maintenance", "dialog")).not.toBeNull()
  })

  test("布局宿主契约：hostId='layout' 的请求被同 hostId 的 wrapper 消费并定位", async () => {
    requestFlash({ leafKey: "data-maintenance", cardKey: "data-maintenance:compression", hostId: "layout" })

    render(
      <SystemLeafWrapper leafKey="data-maintenance" hostId="layout">
        <div>{cardSection("data-maintenance:compression", "上下文压缩")}</div>
      </SystemLeafWrapper>
    )

    const target = document.querySelector('[data-card-key="data-maintenance:compression"]')!
    await waitFor(() => expect(target.classList.contains("settings-flash")).toBe(true))
    expect(scrollIntoViewSpy).toHaveBeenCalled()
  })

  test("事件通道处理后清掉总线请求，避免陈旧请求在下次挂载时复活", async () => {
    requestFlash({ leafKey: "data-maintenance", cardKey: "data-maintenance:compression" })

    render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div>{cardSection("data-maintenance:compression", "上下文压缩")}</div>
      </SystemLeafWrapper>
    )
    await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalled())

    // 事件已处理 → lastRequest 应被清空
    expect(consumeFlash()).toBeNull()
  })

  test("卡片延迟出现时重试定位成功（150ms 间隔内补渲染）", async () => {
    const { container } = render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div data-testid="slot" />
      </SystemLeafWrapper>
    )

    dispatchFlashEvent({ leafKey: "data-maintenance", cardKey: "data-maintenance:compression" })

    // 首轮找不到卡，200ms 后补渲染
    setTimeout(() => {
      const slot = container.querySelector('[data-testid="slot"]')
      slot?.appendChild(
        (() => {
          const el = document.createElement("section")
          el.setAttribute("data-card-key", "data-maintenance:compression")
          el.textContent = "上下文压缩"
          return el
        })()
      )
    }, 200)

    await waitFor(
      () => {
        const target = document.querySelector('[data-card-key="data-maintenance:compression"]')!
        expect(target.classList.contains("settings-flash")).toBe(true)
      },
      { timeout: 3000 }
    )
  })

  test("请求的卡不存在于页面时静默忽略（重试耗尽后停止）", async () => {
    requestFlash({ leafKey: "data-maintenance", cardKey: "data-maintenance:nope" })

    render(
      <SystemLeafWrapper leafKey="data-maintenance">
        <div>{cardSection("data-maintenance:retention", "数据保留策略")}</div>
      </SystemLeafWrapper>
    )

    await new Promise((resolve) => setTimeout(resolve, 80))
    const target = document.querySelector('[data-card-key="data-maintenance:retention"]')!
    expect(target.classList.contains("settings-flash")).toBe(false)
  })
})
