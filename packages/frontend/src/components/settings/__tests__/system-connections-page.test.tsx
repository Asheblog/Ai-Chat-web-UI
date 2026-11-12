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
  displayName: "默认连接",
  connectionIds: [1],
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  authType: "bearer",
  tags: [],
  connectionType: "external",
  defaultCapabilities: {},
  apiKeys: [{ id: 1, apiKeyLabel: "Key 1", modelIds: [], enable: true, hasStoredApiKey: true, apiKeyMasked: "sk-***" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

/** 样例：2 组 OpenAI + 1 组 Responses 连接。 */
const sampleConnections = [
  makeGroup({ id: 1, displayName: "官方 OpenAI", provider: "openai" }),
  makeGroup({
    id: 2,
    displayName: "兼容网关",
    provider: "openai",
    baseUrl: "https://openai.example.com/v1",
  }),
  makeGroup({
    id: 3,
    displayName: "Responses 网关",
    provider: "openai_responses",
    baseUrl: "https://responses.example.com/v1",
    authType: "none",
  }),
]

const getCard = (provider: string) => screen.getByTestId(`provider-template-${provider}`)

beforeEach(() => {
  vi.clearAllMocks()
  toastSpy.mockClear()
  services.fetchSystemConnections.mockResolvedValue(sampleConnections)
  services.createSystemConnection.mockResolvedValue({})
  services.updateSystemConnection.mockResolvedValue({})
  services.verifySystemConnection.mockResolvedValue({
    data: { results: [], successCount: 0, failureCount: 0, totalModels: 0 },
  })
})

afterEach(() => {
  cleanup()
})

describe("provider-templates 模板数据", () => {
  test("3 项且 provider 唯一、顺序固定（OpenAI 双协议合并为一张卡）", () => {
    expect(PROVIDER_TEMPLATES).toHaveLength(3)
    const providers = PROVIDER_TEMPLATES.map((item) => item.provider)
    expect(new Set(providers).size).toBe(3)
    expect(providers).toEqual([
      "openai",
      "google_genai",
      "anthropic",
    ])
    expect(PROVIDER_TEMPLATES[0].protocols?.map((item) => item.provider)).toEqual([
      "openai",
      "openai_responses",
    ])
    expect(getProviderTemplate("openai_responses")?.provider).toBe("openai_responses")
    expect(getProviderTemplate("openai_responses")?.label).toBe("OpenAI Responses")
    expect(getProviderTemplate("anthropic")?.baseUrl).toBe("https://api.anthropic.com/v1")
  })

  test("每项有 label/description/icon/baseUrl/authType", () => {
    PROVIDER_TEMPLATES.forEach((item) => {
      expect(item.label).toBeTruthy()
      expect(item.description).toBeTruthy()
      expect(item.icon).toBeTruthy()
      expect(item.baseUrl).toBeTruthy()
      expect(item.authType).toBe("bearer")
    })
  })

  test("ollama/azure_openai/openai_interleave 已下线；getProviderTemplate 未知返回 undefined", () => {
    expect(getProviderTemplate("ollama")).toBeUndefined()
    expect(getProviderTemplate("azure_openai")).toBeUndefined()
    expect(getProviderTemplate("openai_interleave")).toBeUndefined()
    expect(getProviderTemplate("unknown_provider")).toBeUndefined()
  })
})

describe("SystemConnectionsPage 模板卡 + 向导 Sheet", () => {
  test("渲染 3 张模板卡（OpenAI 双协议/Google/Anthropic；Responses 不再单独成卡）", async () => {
    render(<SystemConnectionsPage />)

    expect(await screen.findByText("OpenAI")).toBeInTheDocument()
    expect(screen.getByText("Google")).toBeInTheDocument()
    expect(screen.getByText("Anthropic")).toBeInTheDocument()
    expect(screen.getByTestId("provider-template-openai")).toBeInTheDocument()
    expect(screen.queryByTestId("provider-template-openai_responses")).not.toBeInTheDocument()
    expect(screen.queryByText("OpenAI（交错思考）")).not.toBeInTheDocument()
    expect(screen.queryByText("Azure")).not.toBeInTheDocument()
    expect(screen.queryByText("Ollama")).not.toBeInTheDocument()
    expect(screen.getByText("供应商与连接")).toBeInTheDocument()
  })

  test("连接数徽标：OpenAI 卡合并 openai + responses（已有 3 组）、Google/Anthropic 未配置", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    expect(within(getCard("openai")).getByText("已有 3 组连接")).toBeInTheDocument()
    expect(within(getCard("google_genai")).getByText("未配置")).toBeInTheDocument()
    expect(within(getCard("anthropic")).getByText("未配置")).toBeInTheDocument()
    expect(screen.queryByTestId("provider-template-ollama")).not.toBeInTheDocument()
    expect(screen.queryByTestId("provider-template-azure_openai")).not.toBeInTheDocument()
    expect(screen.queryByTestId("provider-template-openai_interleave")).not.toBeInTheDocument()
  })

  test("模板卡可访问名 = 「配置{label}」，三张卡都是整卡按钮", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    expect(screen.getByRole("button", { name: "配置OpenAI" })).toBe(getCard("openai"))
    expect(screen.getByRole("button", { name: "配置Google" })).toBe(getCard("google_genai"))
    expect(screen.getByRole("button", { name: "配置Anthropic" })).toBe(getCard("anthropic"))
    expect(screen.queryByRole("combobox", { name: "OpenAI 接口协议" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "配置OpenAI（交错思考）" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "配置Ollama" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "配置Azure" })).not.toBeInTheDocument()
  })

  test("高级管理为一行标题栏（标题 + 端点组数 + 导入/导出/刷新），列表直接可见", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    const section = screen.getByRole("region", { name: "高级管理" })
    expect(within(section).getByRole("heading", { name: "高级管理" })).toBeInTheDocument()
    expect(within(section).getByText("3 个端点组")).toBeInTheDocument()
    expect(within(section).getByRole("button", { name: /导入/ })).toBeInTheDocument()
    expect(within(section).getByRole("button", { name: /导出/ })).toBeInTheDocument()
    expect(within(section).getByRole("button", { name: /刷新/ })).toBeInTheDocument()
    // 列表无需展开即可见
    expect(within(section).getByText("官方 OpenAI")).toBeInTheDocument()
    // 旧卡片式区块（工具栏标题/说明/统计/筛选）已移除
    expect(screen.queryByText("连接管理")).not.toBeInTheDocument()
    expect(screen.queryByText("全部连接列表、导入导出与 API Key 池")).not.toBeInTheDocument()
  })

  test("列表主标题为 displayName，副标题为 provider · baseUrl", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    expect(screen.getByText("官方 OpenAI")).toBeInTheDocument()
    expect(screen.getByText("Responses 网关")).toBeInTheDocument()
    expect(screen.getByText("OpenAI · https://api.openai.com/v1")).toBeInTheDocument()
    expect(screen.getByText("OpenAI Responses · https://responses.example.com/v1")).toBeInTheDocument()
  })

  test("点模板卡 → Sheet 打开到基础信息步，预填 displayName/baseUrl", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("google_genai")).getByText("配置"))
    const dialog = await screen.findByRole("dialog")

    expect(within(dialog).getByText("第 2 步 · 基础信息")).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("Google")
    expect(within(dialog).getByLabelText(/API 端点|Base URL/i)).toHaveValue("https://generativelanguage.googleapis.com/v1beta")
  })

  test("创建时 displayName 必填：清空后点下一步会提示且不进入验证步", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("google_genai")).getByText("配置"))
    const dialog = await screen.findByRole("dialog")

    const nameInput = within(dialog).getByLabelText(/显示名称/)
    await userEvent.clear(nameInput)

    await userEvent.click(within(dialog).getByRole("button", { name: /下一步|继续/ }))

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/未完成|无法|必填/),
        }),
      )
    })
    expect(services.createSystemConnection).not.toHaveBeenCalled()
  })

  test("向导：填写后进入验证步 → 创建连接发送 displayName", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("google_genai")).getByText("配置"))
    const dialog = await screen.findByRole("dialog")

    const nameInput = within(dialog).getByLabelText(/显示名称/)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, "Google 生产")

    const keyInput = within(dialog).getByLabelText(/API Key/)
    await userEvent.type(keyInput, "sk-google-test")

    await userEvent.click(within(dialog).getByRole("button", { name: /下一步|继续/ }))

    expect(await within(dialog).findByRole("button", { name: "创建连接" })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("button", { name: "创建连接" }))

    await waitFor(() => {
      expect(services.createSystemConnection).toHaveBeenCalledTimes(1)
    })
    const payload = services.createSystemConnection.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual(
      expect.objectContaining({
        displayName: "Google 生产",
        provider: "google_genai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        authType: "bearer",
        connectionType: "external",
      }),
    )
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })

  test("抽屉内点「验证连接」→ verifySystemConnection 被调且含 displayName", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("google_genai")).getByText("配置"))
    let dialog = await screen.findByRole("dialog")

    const keyInput = within(dialog).getByLabelText(/API Key/)
    await userEvent.type(keyInput, "sk-google-test")

    await userEvent.click(within(dialog).getByRole("button", { name: /下一步|继续/ }))
    dialog = screen.getByRole("dialog")

    await userEvent.click(within(dialog).getByRole("button", { name: "验证连接" }))

    await waitFor(() => {
      expect(services.verifySystemConnection).toHaveBeenCalledTimes(1)
    })
    const payload = services.verifySystemConnection.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual(
      expect.objectContaining({
        provider: "google_genai",
        displayName: "Google",
      }),
    )
  })

  test("「新建连接」打开向导第 1 步（选择供应商）", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(screen.getByRole("button", { name: /新建连接/ }))
    const dialog = await screen.findByRole("dialog")

    expect(within(dialog).getByText("第 1 步 · 选择供应商")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: /Google/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Ollama/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Azure/ })).not.toBeInTheDocument()
  })

  test("关闭 Sheet 后表单重置（先开 Google 卡 → 再开 OpenAI 卡预填正确）", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(within(getCard("google_genai")).getByText("配置"))
    let dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText(/API 端点|Base URL/i)).toHaveValue("https://generativelanguage.googleapis.com/v1beta")

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    await userEvent.click(getCard("openai"))
    dialog = await screen.findByRole("dialog")

    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("OpenAI")
    expect(within(dialog).getByLabelText(/API 端点|Base URL/i)).toHaveValue("https://api.openai.com/v1")
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

    await userEvent.click(getCard("google_genai"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(within(screen.getByRole("dialog")).getByLabelText(/显示名称/)).toHaveValue("Google")
  })

  test("OpenAI 卡进入配置后选择 Responses，提交 openai_responses", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(getCard("openai"))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("OpenAI")
    await userEvent.click(within(dialog).getByRole("combobox", { name: "接口协议" }))
    await userEvent.click(await screen.findByRole("option", { name: "Responses" }))
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("OpenAI Responses")
    expect(within(dialog).getByRole("combobox", { name: "接口协议" })).toHaveTextContent("Responses")

    await userEvent.type(within(dialog).getByLabelText("API Key"), "sk-responses-test")
    await userEvent.click(within(dialog).getByRole("button", { name: "下一步" }))
    await userEvent.click(within(dialog).getByRole("button", { name: "创建连接" }))

    await waitFor(() => expect(services.createSystemConnection).toHaveBeenCalledTimes(1))
    expect(services.createSystemConnection.mock.calls[0][0]).toEqual(
      expect.objectContaining({ provider: "openai_responses", displayName: "OpenAI Responses" }),
    )
  })

  test("向导内切换协议时，默认 displayName 跟随协议更新", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    await userEvent.click(getCard("openai"))
    let dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("OpenAI")

    await userEvent.click(within(dialog).getByRole("combobox", { name: "接口协议" }))
    await userEvent.click(await screen.findByRole("option", { name: "Responses" }))
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("OpenAI Responses")

    await userEvent.click(within(dialog).getByRole("combobox", { name: "接口协议" }))
    await userEvent.click(await screen.findByRole("option", { name: "Chat Completions" }))
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("OpenAI")
  })

  test("编辑已有 openai_responses 连接时协议回显 Responses", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    const editButtons = screen.getAllByRole("button", { name: /编辑/ })
    await userEvent.click(editButtons[2])

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("Responses 网关")
    expect(within(dialog).getByRole("combobox", { name: "接口协议" })).toHaveTextContent("Responses")
  })

  test("列表编辑打开同一向导 Sheet，主屏含 displayName", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    const editButtons = screen.getAllByRole("button", { name: /编辑/ })
    await userEvent.click(editButtons[0])

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText(/显示名称/)).toHaveValue("官方 OpenAI")
    expect(within(dialog).getByLabelText(/API 端点|Base URL/i)).toHaveValue("https://api.openai.com/v1")
    expect(within(dialog).queryByLabelText("API Version")).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("button", { name: /高级设置/ }))
    await userEvent.click(within(dialog).getByRole("combobox", { name: "认证方式" }))
    expect(screen.queryByRole("option", { name: "Entra ID" })).not.toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await userEvent.click(within(dialog).getByRole("button", { name: "保存连接" }))
    await waitFor(() => expect(services.updateSystemConnection).toHaveBeenCalledTimes(1))
    expect(services.updateSystemConnection.mock.calls[0][1]).toEqual(
      expect.objectContaining({ provider: "openai", authType: "bearer", displayName: "官方 OpenAI" }),
    )
    expect(services.updateSystemConnection.mock.calls[0][1]).not.toHaveProperty("azureApiVersion")
  })

  test.each(PROVIDER_TEMPLATES)("$label 可以完成验证和创建", async (template) => {
    render(<SystemConnectionsPage />)
    const card = await screen.findByRole("button", { name: `配置${template.label}` })
    card.focus()
    await userEvent.keyboard("{Enter}")
    const dialog = await screen.findByRole("dialog")
    await userEvent.type(within(dialog).getByLabelText("API Key"), "sk-fixture")
    await userEvent.click(within(dialog).getByRole("button", { name: "下一步" }))
    await userEvent.click(within(dialog).getByRole("button", { name: "验证连接" }))
    await waitFor(() => expect(services.verifySystemConnection).toHaveBeenCalledTimes(1))
    await userEvent.click(within(dialog).getByRole("button", { name: "创建连接" }))
    await waitFor(() => expect(services.createSystemConnection).toHaveBeenCalledTimes(1))
    const expected = {
      provider: template.provider,
      thinkingDialect: "off",
      baseUrl: template.baseUrl,
      authType: "bearer",
    }
    expect(services.verifySystemConnection.mock.calls[0][0]).toEqual(expect.objectContaining(expected))
    expect(services.createSystemConnection.mock.calls[0][0]).toEqual(expect.objectContaining(expected))
    expect(services.createSystemConnection.mock.calls[0][0]).not.toHaveProperty("azureApiVersion")
    expect(services.createSystemConnection.mock.calls[0][0]).not.toHaveProperty("vendor")
  })

  test("空数据：标题栏显示 0 个端点组，列表显示空状态文案", async () => {
    services.fetchSystemConnections.mockResolvedValue([])
    render(<SystemConnectionsPage />)

    const section = await screen.findByRole("region", { name: "高级管理" })
    expect(await within(section).findByText("0 个端点组")).toBeInTheDocument()
    expect(within(section).getByText(/暂无连接/)).toBeInTheDocument()
    expect(within(section).getByRole("button", { name: /导入/ })).toBeEnabled()
  })

  test("高级管理内列表可见连接行（displayName）", async () => {
    render(<SystemConnectionsPage />)
    await screen.findByText("OpenAI")

    expect(screen.getByText("官方 OpenAI")).toBeInTheDocument()
    expect(screen.getByText("Responses 网关")).toBeInTheDocument()
  })
})