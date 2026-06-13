import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SystemSettings } from "@/components/system-settings"

afterEach(() => {
  cleanup()
})

describe("SystemSettings activeKey prop", () => {
  test("有 activeKey 时渲染对应 leaf（不显示错误 fallback）", () => {
    render(<SystemSettings activeKey="connections" />)

    expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
  })

  test("有 activeKey 时使用无效 key 显示错误 fallback", () => {
    render(<SystemSettings activeKey="nonexistent" />)

    expect(screen.getByText("暂无可用的系统设置模块")).toBeInTheDocument()
  })

  test("无 activeKey 时不崩溃", () => {
    render(<SystemSettings />)

    expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
  })
})

describe("SystemSettings uncontrolled select 事件 key 校验", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("无效 select event 不会切换到 fallback", async () => {
    render(<SystemSettings />)

    await waitFor(() => {
      expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
    })

    window.dispatchEvent(
      new CustomEvent("aichat:system-settings-select", { detail: { key: "nonexistent" } })
    )

    await waitFor(() => {
      expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
    })
  })

  test("无效 select event 不会写入 localStorage", async () => {
    const setItem = vi.fn()
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    })

    render(<SystemSettings />)

    // 等待 useEffect 完成注册
    await vi.waitFor(() => {
      // 确保渲染完成
      expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
    })

    window.dispatchEvent(
      new CustomEvent("aichat:system-settings-select", { detail: { key: "nonexistent" } })
    )

    // 给 React 状态更新一点时间
    await vi.waitFor(() => {
      const calls = setItem.mock.calls.filter(
        (call: unknown[]) => call[0] === "settings:system:v2-module" && call[1] === "nonexistent"
      )
      expect(calls).toHaveLength(0)
    })
  })

  test("有效 select event 正常切换 leaf", async () => {
    render(<SystemSettings />)

    await waitFor(() => {
      expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
    })

    window.dispatchEvent(
      new CustomEvent("aichat:system-settings-select", { detail: { key: "models" } })
    )

    await waitFor(() => {
      expect(screen.queryByText("暂无可用的系统设置模块")).not.toBeInTheDocument()
    })
  })
})
