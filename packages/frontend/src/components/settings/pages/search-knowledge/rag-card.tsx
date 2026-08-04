"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { AlertCircle, Check, ChevronsUpDown, FileText, FolderOpen } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/components/ui/use-toast"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import { FeatureCard } from "@/components/settings/components/feature-card"
import type { ApiResponse, SystemSettings } from "@/types"
import { parseNumericInput } from "@/features/settings/shared"
import { apiHttpClient } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DocManageDialog, type DocumentItem } from "./doc-manage-dialog"

export interface RagCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

export function RagCard({ settings, update }: RagCardProps) {
  const { toast } = useToast()
  const { models, isLoading: modelsLoading, fetchAll: fetchModels } = useModelsStore()

  const [enabled, setEnabled] = useState(false)
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null)
  const [selectedModelId, setSelectedModelId] = useState("")
  const [topK, setTopK] = useState(5)
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.3)
  const [maxContextTokens, setMaxContextTokens] = useState(4000)
  const [chunkSize, setChunkSize] = useState(1500)
  const [chunkOverlap, setChunkOverlap] = useState(100)
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(50)
  const [maxPages, setMaxPages] = useState(200)
  const [retentionDays, setRetentionDays] = useState(30)
  const [embeddingBatchSize, setEmbeddingBatchSize] = useState(1)
  const [embeddingConcurrency, setEmbeddingConcurrency] = useState(1)

  const [modelSelectOpen, setModelSelectOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState("")

  // 文档管理弹框状态
  const [docDialogOpen, setDocDialogOpen] = useState(false)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [docLoading, setDocLoading] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [docSearchQuery, setDocSearchQuery] = useState("")
  const [docStatusFilter, setDocStatusFilter] = useState<string>("all")

  const ranges = {
    topK: { min: 1, max: 20 },
    relevanceThreshold: { min: 0, max: 1 },
    maxContextTokens: { min: 500, max: 32000 },
    chunkSize: { min: 100, max: 8000 },
    chunkOverlap: { min: 0, max: 1000 },
    maxFileSizeMb: { min: 1, max: 200 },
    maxPages: { min: 10, max: 1000 },
    retentionDays: { min: 1, max: 365 },
    embeddingBatchSize: { min: 1, max: 128 },
    embeddingConcurrency: { min: 1, max: 16 },
  }

  // 获取文档列表
  const fetchDocuments = useCallback(async () => {
    setDocLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<DocumentItem[]>>('/documents/admin/all')
      if (res.data.success && res.data.data) {
        setDocuments(res.data.data)
      }
    } catch (e) {
      console.error('Failed to fetch documents:', e)
      toast({
        title: "获取文档列表失败",
        variant: "destructive",
      })
    } finally {
      setDocLoading(false)
    }
  }, [toast])

  // 过滤后的文档列表
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const matchesSearch = docSearchQuery === "" ||
        doc.originalName.toLowerCase().includes(docSearchQuery.toLowerCase())
      const matchesStatus = docStatusFilter === "all" || doc.status === docStatusFilter
      return matchesSearch && matchesStatus
    })
  }, [documents, docSearchQuery, docStatusFilter])

  // 切换选中文档
  const toggleSelectDoc = (id: number) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // 全选/取消全选
  const toggleSelectAllDocs = () => {
    if (selectedDocIds.size === filteredDocuments.length) {
      setSelectedDocIds(new Set())
    } else {
      setSelectedDocIds(new Set(filteredDocuments.map(d => d.id)))
    }
  }

  // 批量删除文档
  const handleBatchDeleteDocs = async () => {
    if (selectedDocIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedDocIds.size} 个文档吗？\n\n这将同时删除：\n• 文档文件\n• 向量数据\n• 数据库记录\n\n并执行 VACUUM 释放空间。`)) return

    setBatchDeleting(true)
    try {
      const res = await apiHttpClient.post<ApiResponse<{
        deleted: number
        failed: number
        requested: number
      }>>('/documents/batch-delete', {
        documentIds: Array.from(selectedDocIds)
      })
      if (res.data.success && res.data.data) {
        toast({
          title: `成功删除 ${res.data.data.deleted} 个文档`,
          description: res.data.data.failed > 0
            ? `${res.data.data.failed} 个文档删除失败`
            : '向量数据已清理，空间已释放',
        })
        setSelectedDocIds(new Set())
        fetchDocuments()
      }
    } catch (e: any) {
      toast({
        title: "批量删除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setBatchDeleting(false)
    }
  }

  // 单个删除文档
  const handleDeleteSingleDoc = async (id: number) => {
    if (!confirm("确定要删除这个文档吗？")) return

    try {
      const res = await apiHttpClient.delete<ApiResponse<any>>(`/documents/${id}`)
      if (res.data.success) {
        toast({ title: "文档已删除" })
        fetchDocuments()
      }
    } catch (e: any) {
      toast({
        title: "删除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  // 打开文档管理弹框时加载数据
  const openDocDialog = () => {
    setDocDialogOpen(true)
    fetchDocuments()
  }

  // 筛选模型列表 - 优先显示 embedding 类型的模型
  const filteredModels = useMemo(() => {
    if (!models) return []

    // 首先筛选出 embedding 类型的模型（embedding 或 both）
    let filtered = models.filter((m: ModelItem) => {
      const modelType = m.modelType || 'chat'
      return modelType === 'embedding' || modelType === 'both'
    })

    // 如果没有专门的 embedding 模型，则显示所有模型（兼容旧数据）
    if (filtered.length === 0) {
      filtered = models
    }

    // 应用关键词筛选
    const kw = modelFilter.trim().toLowerCase()
    if (kw) {
      filtered = filtered.filter((m: ModelItem) =>
        [m.id, m.rawId, m.name, m.provider, m.channelName].some(v =>
          String(v || "").toLowerCase().includes(kw)
        )
      )
    }

    return filtered
  }, [models, modelFilter])

  // 检查是否有专门的 embedding 模型
  const hasEmbeddingModels = useMemo(() => {
    if (!models) return false
    return models.some((m: ModelItem) => {
      const modelType = m.modelType || 'chat'
      return modelType === 'embedding' || modelType === 'both'
    })
  }, [models])

  // 获取当前选中的模型信息
  const selectedModel = useMemo(() => {
    if (!selectedConnectionId || !selectedModelId) return null
    return models?.find((m: ModelItem) =>
      m.connectionId === selectedConnectionId && m.id === selectedModelId
    ) || null
  }, [models, selectedConnectionId, selectedModelId])

  const handleModelSelect = (model: ModelItem) => {
    setSelectedConnectionId(model.connectionId)
    setSelectedModelId(model.id)
    setModelSelectOpen(false)
    setModelFilter("")
  }

  useEffect(() => {
    fetchModels().catch(() => {})
  }, [fetchModels])

  useEffect(() => {
    setEnabled(Boolean(settings.ragEnabled ?? false))
    setSelectedConnectionId(settings.ragEmbeddingConnectionId ?? null)
    setSelectedModelId(settings.ragEmbeddingModelId || "")
    setEmbeddingBatchSize(Number(settings.ragEmbeddingBatchSize ?? 1))
    setEmbeddingConcurrency(Number(settings.ragEmbeddingConcurrency ?? 1))
    setTopK(Number(settings.ragTopK ?? 5))
    setRelevanceThreshold(Number(settings.ragRelevanceThreshold ?? 0.3))
    setMaxContextTokens(Number(settings.ragMaxContextTokens ?? 4000))
    setChunkSize(Number(settings.ragChunkSize ?? 1500))
    setChunkOverlap(Number(settings.ragChunkOverlap ?? 100))
    setMaxFileSizeMb(Number(settings.ragMaxFileSizeMb ?? 50))
    setMaxPages(Number(settings.ragMaxPages ?? 200))
    setRetentionDays(Number(settings.ragRetentionDays ?? 30))
  }, [settings])

  const handleSave = async () => {
    try {
      await update({
        ragEnabled: enabled,
        ragEmbeddingConnectionId: selectedConnectionId ?? undefined,
        ragEmbeddingModelId: selectedModelId || undefined,
        ragEmbeddingBatchSize: Math.max(
          ranges.embeddingBatchSize.min,
          Math.min(ranges.embeddingBatchSize.max, Math.floor(embeddingBatchSize || ranges.embeddingBatchSize.min)),
        ),
        ragEmbeddingConcurrency: Math.max(
          ranges.embeddingConcurrency.min,
          Math.min(ranges.embeddingConcurrency.max, Math.floor(embeddingConcurrency || ranges.embeddingConcurrency.min)),
        ),
        ragTopK: Math.max(ranges.topK.min, Math.min(ranges.topK.max, Math.floor(topK || ranges.topK.min))),
        ragRelevanceThreshold: Math.max(
          ranges.relevanceThreshold.min,
          Math.min(ranges.relevanceThreshold.max, relevanceThreshold || ranges.relevanceThreshold.min),
        ),
        ragMaxContextTokens: Math.max(
          ranges.maxContextTokens.min,
          Math.min(ranges.maxContextTokens.max, Math.floor(maxContextTokens || ranges.maxContextTokens.min)),
        ),
        ragChunkSize: Math.max(ranges.chunkSize.min, Math.min(ranges.chunkSize.max, Math.floor(chunkSize || ranges.chunkSize.min))),
        ragChunkOverlap: Math.max(
          ranges.chunkOverlap.min,
          Math.min(ranges.chunkOverlap.max, Math.floor(chunkOverlap || ranges.chunkOverlap.min)),
        ),
        ragMaxFileSizeMb: Math.max(
          ranges.maxFileSizeMb.min,
          Math.min(ranges.maxFileSizeMb.max, Math.floor(maxFileSizeMb || ranges.maxFileSizeMb.min)),
        ),
        ragMaxPages: Math.max(
          ranges.maxPages.min,
          Math.min(ranges.maxPages.max, Math.floor(maxPages || ranges.maxPages.min)),
        ),
        ragRetentionDays: Math.max(
          ranges.retentionDays.min,
          Math.min(ranges.retentionDays.max, Math.floor(retentionDays || ranges.retentionDays.min)),
        ),
      })
      toast({ title: "RAG 设置已保存", description: "已自动重载并生效" })
    } catch (e: any) {
      toast({
        title: "保存失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const modelDisplayText = selectedModel
    ? `${selectedModel.name || selectedModel.id} (${selectedModel.provider || selectedModel.channelName})`
    : "选择 Embedding 模型..."

  return (
    <>
      <FeatureCard
        icon={FileText}
        title="RAG 文档解析"
        description="附加文档后，AI 基于文档内容回答"
        cardKey="search-knowledge:rag"
        enabled={enabled}
        onEnabledChange={setEnabled}
        more={
          enabled ? (
            <div className="space-y-3">
              <div className="border-t border-border pt-4">
                <h4 className="font-medium mb-3">Embedding 性能参数</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">批量大小</label>
                    <Input
                      type="text"
                      value={embeddingBatchSize}
                      onChange={(e) => setEmbeddingBatchSize((prev) => parseNumericInput(e.target.value, prev))}
                    />
                    <p className="text-xs text-muted-foreground">单次 embedding 请求包含的 chunk 数（{ranges.embeddingBatchSize.min}-{ranges.embeddingBatchSize.max}），越大越快但更易触发限流</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">并发数</label>
                    <Input
                      type="text"
                      value={embeddingConcurrency}
                      onChange={(e) => setEmbeddingConcurrency((prev) => parseNumericInput(e.target.value, prev))}
                    />
                    <p className="text-xs text-muted-foreground">批量请求的并发执行数（{ranges.embeddingConcurrency.min}-{ranges.embeddingConcurrency.max}），建议逐步调大观察稳定性</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <h4 className="font-medium mb-3">文档分块参数</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">分块大小</label>
                    <Input
                      type="text"
                      value={chunkSize}
                      onChange={(e) => setChunkSize((prev) => parseNumericInput(e.target.value, prev))}
                    />
                    <p className="text-xs text-muted-foreground">每个文档片段的字符数（{ranges.chunkSize.min}-{ranges.chunkSize.max}）</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">分块重叠</label>
                    <Input
                      type="text"
                      value={chunkOverlap}
                      onChange={(e) => setChunkOverlap((prev) => parseNumericInput(e.target.value, prev))}
                    />
                    <p className="text-xs text-muted-foreground">相邻片段的重叠字符数（{ranges.chunkOverlap.min}-{ranges.chunkOverlap.max}）</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">最大文件大小 (MB)</label>
                    <Input
                      type="text"
                      value={maxFileSizeMb}
                      onChange={(e) => setMaxFileSizeMb((prev) => parseNumericInput(e.target.value, prev))}
                    />
                    <p className="text-xs text-muted-foreground">允许上传的单文件最大大小（{ranges.maxFileSizeMb.min}-{ranges.maxFileSizeMb.max} MB）</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">最大页数限制</label>
                    <Input
                      type="text"
                      value={maxPages}
                      onChange={(e) => setMaxPages((prev) => parseNumericInput(e.target.value, prev))}
                    />
                    <p className="text-xs text-muted-foreground">PDF 文档最大处理页数，超出将被截断（{ranges.maxPages.min}-{ranges.maxPages.max} 页）。轻量服务器建议 50-100 页。</p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-3">存储管理</h4>
                <div className="space-y-2 max-w-xs">
                  <label className="text-sm font-medium">文档保留天数</label>
                  <Input
                    type="text"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays((prev) => parseNumericInput(e.target.value, prev))}
                  />
                  <p className="text-xs text-muted-foreground">超过此天数的未使用文档将被自动清理（{ranges.retentionDays.min}-{ranges.retentionDays.max} 天）</p>
                </div>
              </div>
            </div>
          ) : undefined
        }
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={openDocDialog}>
              <FolderOpen className="h-4 w-4 mr-2" />
              文档管理
            </Button>
            <Button onClick={handleSave}>保存设置</Button>
          </div>
        }
      >
        <Alert className="v2-panel-soft border-border bg-background/78">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {hasEmbeddingModels
              ? "请从已配置的连接中选择 Embedding 模型。修改设置后会自动重载并生效。"
              : "未检测到专门的 Embedding 模型。请在「连接管理」中添加 Embedding 模型（如 text-embedding-3-small、nomic-embed-text 等）。当前显示所有模型供选择。"
            }
          </AlertDescription>
        </Alert>

        {enabled && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Embedding 模型</label>
              <Popover open={modelSelectOpen} onOpenChange={setModelSelectOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={modelSelectOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">{modelDisplayText}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[480px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="搜索模型..."
                      value={modelFilter}
                      onValueChange={setModelFilter}
                    />
                    <CommandList className="max-h-[300px]">
                      <CommandEmpty>
                        {modelsLoading ? "加载中..." : "未找到匹配的模型"}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredModels.map((model: ModelItem) => {
                          const isSelected = model.connectionId === selectedConnectionId && model.id === selectedModelId
                          return (
                            <CommandItem
                              key={`${model.connectionId}:${model.id}`}
                              value={`${model.connectionId}:${model.id}`}
                              onSelect={() => handleModelSelect(model)}
                              className="flex items-center gap-2"
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4 shrink-0",
                                  isSelected ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">
                                  {model.name || model.id}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {model.provider || model.channelName} · {model.rawId}
                                </div>
                              </div>
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                从已配置的连接中选择支持 Embedding 的模型（如 text-embedding-3-small、embedding-3 等）
              </p>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="font-medium mb-3">检索参数</h4>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Top K</label>
                  <Input
                    type="text"
                    value={topK}
                    onChange={(e) => setTopK((prev) => parseNumericInput(e.target.value, prev))}
                  />
                  <p className="text-xs text-muted-foreground">返回最相关的文档片段数（{ranges.topK.min}-{ranges.topK.max}）</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">相关性阈值</label>
                  <Input
                    type="text"
                    value={relevanceThreshold}
                    onChange={(e) => setRelevanceThreshold((prev) => parseNumericInput(e.target.value, prev))}
                  />
                  <p className="text-xs text-muted-foreground">低于此分数的结果将被过滤（范围 {ranges.relevanceThreshold.min}-{ranges.relevanceThreshold.max}）</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">上下文 Token 限制</label>
                  <Input
                    type="text"
                    value={maxContextTokens}
                    onChange={(e) => setMaxContextTokens((prev) => parseNumericInput(e.target.value, prev))}
                  />
                  <p className="text-xs text-muted-foreground">注入到提示词的最大 token 数（{ranges.maxContextTokens.min}-{ranges.maxContextTokens.max}）</p>
                </div>
              </div>
            </div>
          </>
        )}
      </FeatureCard>

      {/* 文档管理弹框 */}
      <DocManageDialog
        open={docDialogOpen}
        onOpenChange={setDocDialogOpen}
        documents={filteredDocuments}
        loading={docLoading}
        searchQuery={docSearchQuery}
        onSearchQueryChange={setDocSearchQuery}
        statusFilter={docStatusFilter}
        onStatusFilterChange={setDocStatusFilter}
        selectedDocIds={selectedDocIds}
        batchDeleting={batchDeleting}
        onToggleSelectAll={toggleSelectAllDocs}
        onToggleSelect={toggleSelectDoc}
        onBatchDelete={handleBatchDeleteDocs}
        onDeleteSingle={handleDeleteSingleDoc}
        onClearSelection={() => setSelectedDocIds(new Set())}
        onRefresh={fetchDocuments}
      />
    </>
  )
}
