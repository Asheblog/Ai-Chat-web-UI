"use client"

import { useEffect, useMemo, useState } from "react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { FileText, AlertCircle, Search, Check, ChevronsUpDown } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function SystemRAGPage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
  const { toast } = useToast()
  const { models, isLoading: modelsLoading, fetchAll: fetchModels } = useModelsStore()

  const [enabled, setEnabled] = useState(false)
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string>("")
  const [topK, setTopK] = useState(5)
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.3)
  const [maxContextTokens, setMaxContextTokens] = useState(4000)
  const [chunkSize, setChunkSize] = useState(1500)
  const [chunkOverlap, setChunkOverlap] = useState(100)
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(50)
  const [retentionDays, setRetentionDays] = useState(30)

  const [modelSelectOpen, setModelSelectOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState("")

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
    fetchModels().catch(() => {})
  }, [fetchSystemSettings, fetchModels])

  useEffect(() => {
    if (!systemSettings) return
    setEnabled(Boolean(systemSettings.ragEnabled ?? false))
    setSelectedConnectionId(systemSettings.ragEmbeddingConnectionId ?? null)
    setSelectedModelId(systemSettings.ragEmbeddingModelId || "")
    setTopK(Number(systemSettings.ragTopK ?? 5))
    setRelevanceThreshold(Number(systemSettings.ragRelevanceThreshold ?? 0.3))
    setMaxContextTokens(Number(systemSettings.ragMaxContextTokens ?? 4000))
    setChunkSize(Number(systemSettings.ragChunkSize ?? 1500))
    setChunkOverlap(Number(systemSettings.ragChunkOverlap ?? 100))
    setMaxFileSizeMb(Number(systemSettings.ragMaxFileSizeMb ?? 50))
    setRetentionDays(Number(systemSettings.ragRetentionDays ?? 30))
  }, [systemSettings])

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

  if (isLoading && !systemSettings) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!systemSettings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || "无法加载系统设置"}</p>
        <Button variant="outline" className="mt-3" onClick={()=>fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  const handleSave = async () => {
    try {
      await updateSystemSettings({
        ragEnabled: enabled,
        ragEmbeddingConnectionId: selectedConnectionId ?? undefined,
        ragEmbeddingModelId: selectedModelId || undefined,
        ragTopK: topK,
        ragRelevanceThreshold: relevanceThreshold,
        ragMaxContextTokens: maxContextTokens,
        ragChunkSize: chunkSize,
        ragChunkOverlap: chunkOverlap,
        ragMaxFileSizeMb: maxFileSizeMb,
        ragRetentionDays: retentionDays,
      })
      toast({ title: "RAG 设置已保存", description: "重启后端后生效" })
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
    <div className="space-y-6 p-1">
      <div className="flex items-start gap-3">
        <FileText className="h-6 w-6 text-muted-foreground mt-0.5" />
        <div>
          <CardTitle className="text-lg">RAG 文档解析</CardTitle>
          <CardDescription className="mt-1">
            启用后，用户可以在聊天中附加文档，AI 将基于文档内容回答问题
          </CardDescription>
        </div>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {hasEmbeddingModels
            ? "请从已配置的连接中选择 Embedding 模型。修改设置后需要重启后端才能生效。"
            : "未检测到专门的 Embedding 模型。请在「连接管理」中添加 Embedding 模型（如 text-embedding-3-small、nomic-embed-text 等）。当前显示所有模型供选择。"
          }
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {/* 启用开关 */}
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <p className="font-medium">启用 RAG 文档解析</p>
            <p className="text-sm text-muted-foreground">
              允许用户上传文档并在聊天中引用
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <>
            {/* Embedding 模型选择 */}
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

            {/* 检索参数 */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">检索参数</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Top K</label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">返回最相关的文档片段数</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">相关性阈值</label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={relevanceThreshold}
                    onChange={(e) => setRelevanceThreshold(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">低于此分数的结果将被过滤</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">上下文 Token 限制</label>
                  <Input
                    type="number"
                    min={500}
                    max={32000}
                    value={maxContextTokens}
                    onChange={(e) => setMaxContextTokens(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">注入到提示词的最大 token 数</p>
                </div>
              </div>
            </div>

            {/* 分块参数 */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">文档分块参数</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">分块大小</label>
                  <Input
                    type="number"
                    min={100}
                    max={8000}
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">每个文档片段的字符数</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">分块重叠</label>
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">相邻片段的重叠字符数</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">最大文件大小 (MB)</label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={maxFileSizeMb}
                    onChange={(e) => setMaxFileSizeMb(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">允许上传的单文件最大大小</p>
                </div>
              </div>
            </div>

            {/* 存储参数 */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">存储管理</h4>
              <div className="space-y-2 max-w-xs">
                <label className="text-sm font-medium">文档保留天数</label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">超过此天数的未使用文档将被自动清理</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end pt-4 border-t">
        <Button onClick={handleSave}>保存设置</Button>
      </div>
    </div>
  )
}
