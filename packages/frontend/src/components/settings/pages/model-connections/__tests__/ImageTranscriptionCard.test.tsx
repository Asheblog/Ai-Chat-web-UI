import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ImageTranscriptionCard } from "../ImageTranscriptionCard"

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const useSystemConnectionsMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/settings/system-connections/use-system-connections", () => ({
  useSystemConnections: useSystemConnectionsMock,
}))

const apiMocks = vi.hoisted(() => ({
  getAggregatedModels: vi.fn(),
}))
vi.mock("@/features/system/api", () => ({
  getAggregatedModels: apiMocks.getAggregatedModels,
}))

describe("ImageTranscriptionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSystemConnectionsMock.mockReturnValue({ connections: [] })
    // 这两个用例不依赖模型列表；用挂起 Promise 避免异步 setState 触发 act 警告
    apiMocks.getAggregatedModels.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    cleanup()
  })

  it("renders switch bound to imageTranscriptionEnabled", () => {
    const update = vi.fn()
    render(
      <ImageTranscriptionCard
        settings={{ imageTranscriptionEnabled: false } as any}
        update={update}
      />,
    )
    expect(screen.getByText(/图片转写代理/)).toBeInTheDocument()
  })

  it("calls update with enabled true when toggled", async () => {
    const update = vi.fn()
    render(
      <ImageTranscriptionCard
        settings={{ imageTranscriptionEnabled: false } as any}
        update={update}
      />,
    )
    await userEvent.click(screen.getByRole("switch"))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ imageTranscriptionEnabled: true }))
  })
})
