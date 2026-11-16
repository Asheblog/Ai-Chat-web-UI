import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SearchKnowledgePage } from "@/components/settings/pages/search-knowledge/SearchKnowledgePage"
import type { SystemSettings } from "@/types"
import { baseSettings } from "./system-settings-pages.fixtures"

const useSystemSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-system-settings", () => ({
  useSystemSettings: useSystemSettingsMock,
}))

const useModelsStoreMock = vi.hoisted(() => vi.fn())
vi.mock("@/store/models-store", () => ({
  useModelsStore: () => useModelsStoreMock(),
}))

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}))

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}))
vi.mock("@/lib/api", () => ({
  apiHttpClient: apiMocks,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/main/settings/system/search-knowledge",
}))

/** 联网搜索 + 文档与知识库 两卡所需的完整设置 */
const searchKnowledgeSettings: SystemSettings = {
  ...baseSettings,
  webSearchEnabledEngines: ["tavily"],
  webSearchHasApiKeyDeepseek: false,
  webSearchScope: "webpage",
  webSearchIncludeSummary: false,
  webSearchIncludeRaw: false,
  webSearchAutoReadBatchTimeoutMs: 18000,
  ragEnabled: true,
  ragEmbeddingConnectionId: 1,
  ragEmbeddingModelId: "text-embedding-3-small",
  ragEmbeddingBatchSize: 1,
  ragEmbeddingConcurrency: 1,
  ragTopK: 5,
  ragRelevanceThreshold: 0.3,
  ragMaxContextTokens: 4000,
  ragChunkSize: 1500,
  ragChunkOverlap: 100,
  ragMaxFileSizeMb: 50,
  ragMaxPages: 200,
  ragRetentionDays: 30,
  knowledgeBaseEnabled: true,
  knowledgeBaseAllowAnonymous: false,
  knowledgeBaseAllowUsers: true,
}

const sampleEmbeddingModels = [
  {
    id: "text-embedding-3-small",
    rawId: "text-embedding-3-small",
    name: "Text Embedding 3 Small",
    provider: "OpenAI",
    channelName: "openai",
    connectionBaseUrl: "https://api.openai.com",
    connectionId: 1,
    modelType: "embedding",
  },
]

const refreshSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<(arg: Partial<SystemSettings>) => Promise<void>>(() => Promise.resolve())

const mockSystemSettings = (
  settings: SystemSettings | null,
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

/** 通过卡片标题定位 FeatureCard 的 <section> 根节点 */
const getCard = (title: string) => {
  const heading = screen.getByText(title)
  const section = heading.closest("section")
  if (!section) throw new Error(`未找到卡片容器: ${title}`)
  return section as HTMLElement
}

const saveSearchCard = async () => {
  await userEvent.click(screen.getByRole("button", { name: "保存联网搜索设置" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
  updateSpy.mockResolvedValue(undefined)
  mockSystemSettings(searchKnowledgeSettings)
  useModelsStoreMock.mockReturnValue({
    models: sampleEmbeddingModels,
    isLoading: false,
    fetchAll: vi.fn(() => Promise.resolve()),
  })
  apiMocks.get.mockImplementation((url: string) => {
    if (url === "/knowledge-bases/admin") {
      return Promise.resolve({ data: { success: true, data: [] } })
    }
    if (url === "/documents/admin/all") {
      return Promise.resolve({ data: { success: true, data: [] } })
    }
    return Promise.resolve({ data: { success: true, data: null } })
  })
})

afterEach(() => {
  cleanup()
})

describe("SearchKnowledgePage 结构", () => {
  test("渲染联网搜索与文档与知识库两张卡", () => {
    render(<SearchKnowledgePage />)
    expect(screen.getByText("搜索与知识库")).toBeInTheDocument()
    expect(screen.getByText("联网搜索")).toBeInTheDocument()
    expect(screen.getByText("文档与知识库")).toBeInTheDocument()
    // 文档能力只有一个模式选择器，不再是 RAG/知识库两个布尔主开关
    expect(screen.getByRole("switch", { name: "启用联网搜索" })).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "启用知识库" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "启用RAG 文档解析" })).not.toBeInTheDocument()
  })

  test("settings 为 null 且 isLoading 时显示加载骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<SearchKnowledgePage />)
    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByText("联网搜索")).not.toBeInTheDocument()
  })
})

describe("联网搜索：有序引擎列表", () => {
  test("引擎顺序就是启用引擎数组本身，保存时不再提交独立顺序键", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      webSearchEnabledEngines: ["tavily", "deepseek"],
      webSearchHasApiKeyDeepseek: true,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    expect(within(card).getByText("#1")).toBeInTheDocument()
    await userEvent.click(within(card).getByRole("button", { name: "上移 DeepSeek" }))
    expect(within(card).getByText("#1")).toBeInTheDocument()

    await saveSearchCard()
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))

    const payload = updateSpy.mock.calls[0][0]
    expect(payload.webSearchEnabledEngines).toEqual(["deepseek", "tavily"])
    expect(payload).not.toHaveProperty("webSearchEngineOrder")
    expect(payload).not.toHaveProperty("webSearchParallelMergeStrategy")
    expect(payload).not.toHaveProperty("webSearchAutoBilingual")
  })

  test("取消勾选把引擎移出列表", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      webSearchEnabledEngines: ["tavily", "brave"],
      webSearchHasApiKeyBrave: true,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    await userEvent.click(within(card).getByRole("checkbox", { name: "Brave" }))
    await saveSearchCard()
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0].webSearchEnabledEngines).toEqual(["tavily"])
  })

  test("已启用但没配 Key 的引擎给出运行时跳过提示", () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      webSearchHasApiKeyTavily: false,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    expect(within(card).getAllByText(/未配置 Key/).length).toBeGreaterThan(0)
    expect(within(card).getByText(/联网搜索不会真正执行/)).toBeInTheDocument()
  })
})

describe("联网搜索：双语、范围与执行参数", () => {
  test("双语只有一个三态选择器，查询扩展数为 1 时提示不会生效", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      webSearchParallelMaxQueriesPerCall: 1,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    expect(within(card).queryByRole("switch", { name: /自动双语/ })).not.toBeInTheDocument()
    expect(within(card).getByLabelText("自动双语检索")).toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))
    expect(within(card).getByText(/双语扩展不会生效/)).toBeInTheDocument()
  })

  test("搜索范围不依赖 Metaso：只启用 Tavily 时仍可设置范围", () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      webSearchEnabledEngines: ["tavily"],
    })
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    expect(within(card).getByLabelText("默认搜索范围")).toBeInTheDocument()
    expect(within(card).queryByLabelText("Metaso 默认搜索范围")).not.toBeInTheDocument()
  })

  test("自动阅读批次总时限在更多参数里可改并进 payload", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))
    const batchInput = within(card).getByLabelText("自动阅读批次总时限（毫秒）")
    expect(batchInput).toHaveValue("18000")

    fireEvent.change(batchInput, { target: { value: "21000" } })
    await saveSearchCard()
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0].webSearchAutoReadBatchTimeoutMs).toBe(21000)
  })

  test("凭据留空不提交，显式清除提交空串", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    const keyInput = within(card).getByLabelText("Tavily API Key")
    expect(keyInput).toHaveValue("")

    await userEvent.click(within(card).getByRole("button", { name: "清除 Tavily Key" }))
    expect(within(card).getByText("保存后将删除 Tavily Key。")).toBeInTheDocument()

    await saveSearchCard()
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0].webSearchApiKeyTavily).toBe("")
  })
})

describe("保存失败", () => {
  test("失败时提示失败并保留当前输入", async () => {
    updateSpy.mockRejectedValueOnce(new Error("权限不足：仅管理员可修改"))
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    const limitInput = within(card).getByLabelText("每次融合结果数")
    fireEvent.change(limitInput, { target: { value: "7" } })
    await saveSearchCard()

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", title: expect.stringContaining("保存失败") }),
      )
    })
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "联网搜索设置已保存" }),
    )
    expect(limitInput).toHaveValue("7")
  })
})

describe("文档与知识库", () => {
  test("知识库模式下展示访问策略与知识库管理，并保存两个能力键", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    expect(within(card).getByRole("switch", { name: "允许匿名用户使用" })).toBeInTheDocument()
    expect(within(card).getByRole("switch", { name: "允许注册用户使用" })).toBeInTheDocument()
    expect(within(card).getByText(/单文件上限 50MB/)).toBeInTheDocument()

    fireEvent.change(within(card).getByLabelText("Top K"), { target: { value: "6" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))

    const payload = updateSpy.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        ragEnabled: true,
        knowledgeBaseEnabled: true,
        ragEmbeddingConnectionId: 1,
        ragEmbeddingModelId: "text-embedding-3-small",
        ragTopK: 6,
        ragMaxFileSizeMb: 50,
        knowledgeBaseAllowAnonymous: false,
        knowledgeBaseAllowUsers: true,
      }),
    )
  })

  test("仅聊天附件模式保留检索参数但不显示知识库，保存时关闭知识库", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      knowledgeBaseEnabled: false,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    expect(within(card).getByText("Embedding 模型")).toBeInTheDocument()
    expect(within(card).getByLabelText("Top K")).toBeInTheDocument()
    expect(within(card).queryByRole("switch", { name: "允许匿名用户使用" })).not.toBeInTheDocument()
    expect(within(card).queryByText(/单文件上限/)).not.toBeInTheDocument()

    fireEvent.change(within(card).getByLabelText("Top K"), { target: { value: "6" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ ragEnabled: true, knowledgeBaseEnabled: false }),
    )
  })

  test("关闭模式下隐藏 Embedding 与检索参数，保存时两个能力键都为 false", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      ragEnabled: false,
      knowledgeBaseEnabled: false,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    expect(within(card).queryByText("Embedding 模型")).not.toBeInTheDocument()
    expect(within(card).queryByLabelText("Top K")).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))
    fireEvent.change(within(card).getByLabelText("分块大小"), { target: { value: "1200" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ ragEnabled: false, knowledgeBaseEnabled: false }),
    )
  })

  test("缺少 Embedding 模型时不允许保存，避免文档服务无法初始化", () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      ragEmbeddingConnectionId: null,
      ragEmbeddingModelId: "",
    })
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    expect(within(card).getByText(/需要选择 Embedding 模型/)).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: "保存设置" })).toBeDisabled()
  })

  test("高级参数默认收起，展开后可改分块与文件上限", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    expect(within(card).queryByText("Embedding 性能")).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))
    expect(within(card).getByText("Embedding 性能")).toBeInTheDocument()
    expect(within(card).getByText("文档分块与限制")).toBeInTheDocument()

    fireEvent.change(within(card).getByLabelText("最大文件大小 (MB)"), { target: { value: "80" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0].ragMaxFileSizeMb).toBe(80)
  })
})
describe("文档与知识库：旧组合（知识库开、文档解析关）", () => {
  test("解析为知识库模式，不静默关掉知识库，并说明保存会一并开启文档解析", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      ragEnabled: false,
      knowledgeBaseEnabled: true,
    })
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    // 知识库这一侧的独立开关是合法状态：不能被解释成「关闭」
    expect(within(card).getByRole("switch", { name: "允许匿名用户使用" })).toBeInTheDocument()
    expect(within(card).getByText(/单文件上限 50MB/)).toBeInTheDocument()
    expect(within(card).getByText(/知识库依赖文档解析能力/)).toBeInTheDocument()

    // 保存时把依赖补回来，而不是把知识库关掉
    fireEvent.change(within(card).getByLabelText("Top K"), { target: { value: "6" } })
    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ ragEnabled: true, knowledgeBaseEnabled: true }),
    )
  })

  test("旧组合下缺少 Embedding 模型时不允许保存，避免知识库停在不可用状态", () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      ragEnabled: false,
      knowledgeBaseEnabled: true,
      ragEmbeddingConnectionId: null,
      ragEmbeddingModelId: "",
    })
    render(<SearchKnowledgePage />)
    const card = getCard("文档与知识库")

    expect(within(card).getByText(/需要选择 Embedding 模型/)).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: "保存设置" })).toBeDisabled()
  })
})
