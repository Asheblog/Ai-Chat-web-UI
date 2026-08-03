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

/** 联网搜索 + RAG + 知识库 三卡所需 key 的完整设置 */
const searchKnowledgeSettings: SystemSettings = {
  ...baseSettings,
  webSearchAgentEnable: true,
  webSearchEnabledEngines: ["tavily"],
  webSearchEngineOrder: ["tavily"],
  webSearchResultLimit: 4,
  webSearchDomainFilter: ["example.com"],
  webSearchHasApiKeyTavily: true,
  webSearchScope: "webpage",
  webSearchIncludeSummary: false,
  webSearchIncludeRaw: false,
  webSearchParallelMaxEngines: 3,
  webSearchParallelMaxQueriesPerCall: 2,
  webSearchParallelTimeoutMs: 12000,
  webSearchAutoBilingual: true,
  webSearchAutoBilingualMode: "conditional",
  webSearchAutoReadParallelism: 2,
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

const refreshSpy = vi.fn<[], Promise<void>>(() => Promise.resolve())
const updateSpy = vi.fn<[Partial<SystemSettings>], Promise<void>>(() => Promise.resolve())

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

beforeEach(() => {
  vi.clearAllMocks()
  refreshSpy.mockClear()
  updateSpy.mockClear()
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

describe("SearchKnowledgePage", () => {
  test("渲染三张功能卡：联网搜索 / RAG 文档解析 / 知识库", () => {
    render(<SearchKnowledgePage />)
    expect(screen.getByText("搜索与知识库")).toBeInTheDocument()
    expect(screen.getByText("联网搜索")).toBeInTheDocument()
    expect(screen.getByText("RAG 文档解析")).toBeInTheDocument()
    expect(screen.getByText("知识库")).toBeInTheDocument()
    // 三个主开关
    expect(screen.getByRole("switch", { name: "启用联网搜索" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "启用RAG 文档解析" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "启用知识库" })).toBeInTheDocument()
  })

  test("联网搜索「更多参数」默认收起，点击后展开并行数值/双语/Metaso", async () => {
    mockSystemSettings({
      ...searchKnowledgeSettings,
      webSearchEnabledEngines: ["tavily", "metaso"],
      webSearchEngineOrder: ["tavily", "metaso"],
    })
    render(<SearchKnowledgePage />)
    const card = getCard("联网搜索")

    expect(within(card).queryByText("并行引擎上限（1-3）")).not.toBeInTheDocument()
    expect(within(card).queryByText("自动双语检索")).not.toBeInTheDocument()
    expect(within(card).queryByText("Metaso 默认搜索范围")).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))

    expect(within(card).getByText("并行引擎上限（1-3）")).toBeInTheDocument()
    expect(within(card).getByText("自动双语检索")).toBeInTheDocument()
    expect(within(card).getByText("Metaso 默认搜索范围")).toBeInTheDocument()
  })

  test("RAG「更多参数」默认收起，点击后展开性能/分块/存储管理", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("RAG 文档解析")

    expect(within(card).queryByText("Embedding 性能参数")).not.toBeInTheDocument()
    expect(within(card).queryByText("文档分块参数")).not.toBeInTheDocument()
    expect(within(card).queryByText("存储管理")).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole("button", { name: "更多参数" }))

    expect(within(card).getByText("Embedding 性能参数")).toBeInTheDocument()
    expect(within(card).getByText("文档分块参数")).toBeInTheDocument()
    expect(within(card).getByText("存储管理")).toBeInTheDocument()
  })

  test("联网搜索保存 payload 完整且不含 python*/agentMaxToolIterations/chatDynamicSkillRuntimeEnabled", async () => {
    render(<SearchKnowledgePage />)

    fireEvent.change(screen.getByLabelText("每次融合结果数（1-10）"), {
      target: { value: "5" },
    })
    await userEvent.click(screen.getByRole("button", { name: "保存联网搜索设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        webSearchAgentEnable: true,
        webSearchEnabledEngines: ["tavily"],
        webSearchEngineOrder: ["tavily"],
        webSearchResultLimit: 5,
        webSearchDomainFilter: ["example.com"],
        webSearchScope: "webpage",
        webSearchIncludeSummary: false,
        webSearchIncludeRaw: false,
        // 并行引擎上限被 clamp 到已启用引擎数（仅 tavily → 1），与源页面一致
        webSearchParallelMaxEngines: 1,
        webSearchParallelMaxQueriesPerCall: 2,
        webSearchParallelTimeoutMs: 12000,
        webSearchParallelMergeStrategy: "hybrid_score_v1",
        webSearchAutoBilingual: true,
        webSearchAutoBilingualMode: "conditional",
        webSearchAutoReadParallelism: 2,
      }),
    )
    expect(payload).not.toHaveProperty("pythonToolEnable")
    expect(payload).not.toHaveProperty("pythonToolTimeoutMs")
    expect(payload).not.toHaveProperty("pythonToolMaxOutputChars")
    expect(payload).not.toHaveProperty("pythonToolMaxSourceChars")
    expect(payload).not.toHaveProperty("agentMaxToolIterations")
    expect(payload).not.toHaveProperty("chatDynamicSkillRuntimeEnabled")
  })

  test("RAG 卡保存 payload 包含全部 rag* key", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("RAG 文档解析")

    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    const payload = updateSpy.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        ragEnabled: true,
        ragEmbeddingConnectionId: 1,
        ragEmbeddingModelId: "text-embedding-3-small",
        ragTopK: 5,
        ragRelevanceThreshold: 0.3,
        ragMaxContextTokens: 4000,
        ragChunkSize: 1500,
        ragChunkOverlap: 100,
        ragMaxFileSizeMb: 50,
        ragMaxPages: 200,
        ragRetentionDays: 30,
        ragEmbeddingBatchSize: 1,
        ragEmbeddingConcurrency: 1,
      }),
    )
  })

  test("知识库卡保存 payload 包含 knowledgeBase* 三个 key", async () => {
    render(<SearchKnowledgePage />)
    const card = getCard("知识库")

    await userEvent.click(within(card).getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        knowledgeBaseEnabled: true,
        knowledgeBaseAllowAnonymous: false,
        knowledgeBaseAllowUsers: true,
      }),
    )
  })

  test("关闭联网搜索主开关后保存，payload 中 webSearchAgentEnable=false", async () => {
    render(<SearchKnowledgePage />)

    await userEvent.click(screen.getByRole("switch", { name: "启用联网搜索" }))
    await userEvent.click(screen.getByRole("button", { name: "保存联网搜索设置" }))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ webSearchAgentEnable: false }),
    )
  })

  test("settings 为 null 且 isLoading 时显示加载骨架，不崩溃", () => {
    mockSystemSettings(null, { isLoading: true })
    const { container } = render(<SearchKnowledgePage />)

    expect(container.querySelector(".animate-pulse")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument()
    expect(screen.queryByText("联网搜索")).not.toBeInTheDocument()
  })
})
