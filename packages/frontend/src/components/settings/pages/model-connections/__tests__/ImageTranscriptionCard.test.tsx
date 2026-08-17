import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
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
  probeImageTranscription: vi.fn(),
}))
vi.mock("@/features/system/api", () => ({
  getAggregatedModels: apiMocks.getAggregatedModels,
}))
vi.mock("@/features/settings/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/settings/api")>()
  return {
    ...actual,
    probeImageTranscription: apiMocks.probeImageTranscription,
  }
})

const configuredSettings = {
  imageTranscriptionEnabled: true,
  imageTranscriptionConnectionId: 7,
  imageTranscriptionModelId: "vision-model",
  imageTranscriptionReasoningEnabled: false,
  imageTranscriptionReasoningEffort: "unset" as const,
  imageTranscriptionOllamaThink: false,
}

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
    await userEvent.click(screen.getByRole("switch", { name: "启用图片转写代理" }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ imageTranscriptionEnabled: true }))
  })

  it("toggling reasoning switch calls update with imageTranscriptionReasoningEnabled", async () => {
    const update = vi.fn()
    render(<ImageTranscriptionCard settings={configuredSettings as any} update={update} />)

    await userEvent.click(screen.getByRole("button", { name: /更多参数/ }))
    expect(screen.getByText("思考模式")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("switch", { name: "思考模式" }))
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ imageTranscriptionReasoningEnabled: true }),
    )
  })

  it("probe button disabled when not configured", () => {
    const update = vi.fn()
    render(
      <ImageTranscriptionCard
        settings={
          {
            imageTranscriptionEnabled: false,
            imageTranscriptionConnectionId: null,
            imageTranscriptionModelId: null,
          } as any
        }
        update={update}
      />,
    )

    expect(screen.getByRole("button", { name: "测试转写代理" })).toBeDisabled()
  })

  it("probe button click calls API and shows success UI", async () => {
    apiMocks.probeImageTranscription.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        steps: [
          { name: "transcribe", ok: true, durationMs: 12, detail: "一只猫" },
          { name: "relevance", ok: true, durationMs: 8, detail: "相关" },
        ],
      },
    })

    const update = vi.fn()
    render(<ImageTranscriptionCard settings={configuredSettings as any} update={update} />)

    const probeButton = screen.getByRole("button", { name: "测试转写代理" })
    expect(probeButton).toBeEnabled()
    await userEvent.click(probeButton)

    await waitFor(() => {
      expect(apiMocks.probeImageTranscription).toHaveBeenCalled()
    })

    expect(await screen.findByText("成功")).toBeInTheDocument()
    expect(screen.getByText(/transcribe/i)).toBeInTheDocument()
    expect(screen.getByText(/12\s*ms/i)).toBeInTheDocument()
    expect(screen.getByText("一只猫")).toBeInTheDocument()
  })

  it("probe button click shows failure UI when probe fails", async () => {
    apiMocks.probeImageTranscription.mockResolvedValue({
      success: true,
      data: {
        ok: false,
        steps: [
          {
            name: "transcribe",
            ok: false,
            durationMs: 5,
            error: "转写模型请求失败（HTTP 502）",
          },
        ],
      },
    })

    const update = vi.fn()
    render(<ImageTranscriptionCard settings={configuredSettings as any} update={update} />)

    await userEvent.click(screen.getByRole("button", { name: "测试转写代理" }))

    await waitFor(() => {
      expect(apiMocks.probeImageTranscription).toHaveBeenCalled()
    })

    expect(await screen.findByText("失败")).toBeInTheDocument()
    expect(screen.getByText("转写模型请求失败（HTTP 502）")).toBeInTheDocument()
  })
})
