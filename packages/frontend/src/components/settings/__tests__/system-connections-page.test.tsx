import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SystemConnectionsPage } from "@/components/settings/pages/SystemConnections"
import {
  getProviderTemplate,
  PROVIDER_TEMPLATES,
} from "@/components/settings/system-connections/provider-templates"
import type { SystemConnectionGroup } from "@/services/system-connections"

// jsdom 未实现 Pointer Capture API，Radix Select 打开菜单依赖它
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const services = vi.hoisted(() => ({
  fetchSystemConnections: vi.fn(),
  createSystemConnection: vi.fn(),
  updateSystemConnection: vi.fn(),
  deleteSystemConnection: vi.fn(),
  verifySystemConnection: vi.fn(),
  exportSystemConnections: vi.fn(),
  importSystemConnections: vi.fn(),
  downloadConnectionsExport: vi.fn(),
}))

vi.mock("@/services/system-connections", () => services)

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const makeGroup = (overrides: Partial<SystemConnectionGroup>): SystemConnectionGroup => ({
  id: 1,
  connectionIds: [1],
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  authType: "bearer",
  tags: [],
  connectionType: "external",
  defaultCapabilities: {},
  apiKeys: [{ id: 1, apiKeyLabel: "Key 1", modelIds: [], enable: true }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

/** 样例：2 组 openai + 1 组 ollama */
const sampleConnections = [
  makeGroup({ id: 1, provider: "openai" }),
  makeGroup({ id: 2, provider: "openai", baseUrl: "https://openai.example.com/v1" }),
  makeGroup({ id: 3, provider: "ollama", baseUrl: "http://localhost:11434", authType: "none" }),
]

const getCard = (provider: string) => screen.getByTestId(`provider-template-${provider}`)

/** 可见的 Sheet 头部标题（忽略 Sheet 内部 sr-only 的 Dialog Title 重复节点） */
const sheetHeading = (label: string) =>
  within(screen.getByRole("dialog")).getByText(`配置 ${label}`, { ignore: ".sr-only" })

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  services.fetchSystemConnections.mockResolvedValue(sampleConnections)
  services.createSystemConnection.mockResolvedValue({})
  services.verifySystemConnection.mockResolvedValue({
    data: { results: [], successCount: 0, failureCount: 0, totalModels: 0 },
  })
})

afterEach(() => {
  cleanup()
})

describe("provider-templates 模板数据", () => {
  test("6 项且 provider 唯一、顺序固定", () => {
    expect(PROVIDER_TEMPLATES).toHaveLength(6)
    const providers = PROVIDER_TEMPLATES.map((item) => item.provider)
    expect(new Set(providers).size).toBe(6)
    expect(providers).toEqual([
      "openai",
      "openai_responses",
      "azure_openai",
      "ollama",
      "google_genai",
      "openai_interleave",
    ])
  })

  test("每项有 label/description/icon/baseUrl/authType", () => {
    PROVIDER_TEMPLATES.forEach((item) => {
      expect(item.label).toBeTruthy()
      expect(item.description).toBeTruthy()
      expect(item.icon).toBeTruthy()
      expect(item.baseUrl).toBeTruthy()
      expect(["bearer", "none"]).toContain(item.authType)
    })
  })

  test("ollama authType none；azure_openai 有 azureApiVersion；getProviderTemplate 未知返回 undefined", () => {
    expect(getProviderTemplate("ollama")?.authType).toBe("none")
    expect(getProviderTemplate("ollama")?.baseUrl).toBe("http://localhost:11434")
    expect(getProviderTemplate("azure_openai")?.azureApiVersion).toBe("2024-02-15-preview")
    expect(getProviderTemplate("openai_interleave")?.baseUrl).toBe("https://api.deepseek.com/v1")
    expect(getProviderTemplate("unknown_provider")).toBeUndefined()
  })
})

describe("SystemConnectionsPage 模板卡 + Sheet 配置抽屉", () => {
  test("渲染 6 张模板卡（OpenAI/Azure/Ollama/Google/Responses/交错思考 标签可见）", async () => {
    render(<SystemConnectionsPage />)

    expect(await screen.findByText("OpenAI")).toBeInTheDocument()
    expect(screen.getByText("OpenAI Responses")).toBeInTheDocument()
    expect(screen.getByText("Azure")).toBeInTheDocument()
    expect(screen.getByText("Ollama")).toBeInTheDocument()
    expect(screen.getByText("Google")).toBeInTheDocument()
    expect(screen.getByText("OpenAI（交错思考）")).toBeInTheDocument()
    expect(screen.getByText("供应商与连接")).toBeInTheDocument()
  })

  test("连接数徽标：openai 卡「已有 2 组连接」、ollama 卡「已有 1 组连接」、google_genai 卡「未配置」", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    expect(within(getCard("openai")).getByText("已有 2 组连接")).toBeInTheDocument()
    expect(within(getCard("ollama")).getByText("已有 1 组连接")).toBeInTheDocument()
    expect(within(getCard("google_genai")).getByText("未配置")).toBeInTheDocument()
  })

  test("高级管理默认收起（工具栏「连接管理」不可见）→ 点击展开可见", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    expect(screen.queryByText("连接管理")).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /高级管理/ }))
    expect(screen.getByText("连接管理")).toBeInTheDocument()
    expect(screen.getByText("全部连接列表、导入导出与 API Key 池")).toBeInTheDocument()
  })

  test("点「配置」（Ollama 卡）→ Sheet 打开，标题「配置 Ollama」，表单预填 baseUrl 且 authType none", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("ollama")).getByText("配置"))
    const dialog = await screen.findByRole("dialog")

    expect(sheetHeading("Ollama")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("API 端点")).toHaveValue("http://localhost:11434")

    // 展开高级设置后可读认证方式 Select 值
    await userEvent.click(within(dialog).getByRole("button", { name: /高级设置/ }))
    expect(within(dialog).getByText("None")).toBeInTheDocument()
  })

  test("抽屉内点「创建连接」→ createSystemConnection 被调（payload.provider === ollama 且 baseUrl 预填）", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("ollama")).getByText("配置"))
    const dialog = await screen.findByRole("dialog")

    await userEvent.click(within(dialog).getByRole("button", { name: "创建连接" }))

    await waitFor(() => {
      expect(services.createSystemConnection).toHaveBeenCalledTimes(1)
    })
    const payload = services.createSystemConnection.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual(
      expect.objectContaining({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        authType: "none",
        connectionType: "external",
      }),
    )
    // 创建成功后 Sheet 关闭
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })

  test("抽屉内点「验证连接」→ verifySystemConnection 被调", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("ollama")).getByText("配置"))
    const dialog = await screen.findByRole("dialog")

    await userEvent.click(within(dialog).getByRole("button", { name: "验证连接" }))

    await waitFor(() => {
      expect(services.verifySystemConnection).toHaveBeenCalledTimes(1)
    })
    const payload = services.verifySystemConnection.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual(expect.objectContaining({ provider: "ollama" }))
  })

  test("关闭 Sheet 后表单重置（再开 OpenAI 卡 → provider 为 openai）", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    // 先打开 Ollama 卡，关闭后表单重置
    await userEvent.click(within(getCard("ollama")).getByText("配置"))
    let dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("API 端点")).toHaveValue("http://localhost:11434")

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    // 再开 OpenAI 卡 → provider 为 openai，端点预填官方值
    await userEvent.click(within(getCard("openai")).getByText("配置"))
    dialog = await screen.findByRole("dialog")

    expect(sheetHeading("OpenAI")).toBeInTheDocument()
    expect(within(dialog).getByText("OpenAI")).toBeInTheDocument() // Provider Select 值
    expect(within(dialog).getByLabelText("API 端点")).toHaveValue("https://api.openai.com/v1")
    expect(within(dialog).getByLabelText("API Key")).toHaveValue("")
  })

  test("加载中渲染骨架（fetch 未返回时）", () => {
    services.fetchSystemConnections.mockReturnValue(new Promise(() => {}))
    const { container } = render(<SystemConnectionsPage />)

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
    expect(screen.queryByText("Ollama")).not.toBeInTheDocument()
  })

  test("「配置」按钮与卡片点击均可打开 Sheet", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    // 卡片本身可点击打开
    await userEvent.click(getCard("google_genai"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(sheetHeading("Google")).toBeInTheDocument()
  })

  test("高级管理内列表展开后保留编辑入口（连接行可见）", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(screen.getByRole("button", { name: /高级管理/ }))
    expect(screen.getByText("https://api.openai.com/v1")).toBeInTheDocument()
    expect(screen.getByText("http://localhost:11434")).toBeInTheDocument()
  })
})
