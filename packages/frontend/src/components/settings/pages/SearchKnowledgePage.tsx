"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import type { ChangeEvent } from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  FileText,
  Filter,
  FolderOpen,
  Globe,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import type { ApiResponse, WebSearchBilingualMode, WebSearchEngine } from "@/types"
import { formatDateTime, formatFileSize, parseNumericInput } from "@/features/settings/shared"
import { apiHttpClient } from "@/lib/api"
import { cn } from "@/lib/utils"
import { FeatureCard } from "@/components/settings/components/feature-card"

const ENGINE_OPTIONS: Array<{ value: WebSearchEngine; label: string }> = [
  { value: "tavily", label: "Tavily" },
  { value: "brave", label: "Brave" },
  { value: "metaso", label: "Metaso（秘塔）" },
  { value: "exa", label: "Exa" },
]

const mergeStrategy = "hybrid_score_v1" as const

const normalizeEngineList = (
  value: unknown,
  fallback: WebSearchEngine[] = ["tavily"],
): WebSearchEngine[] => {
  const source = Array.isArray(value) ? value : []
  const normalized = Array.from(
    new Set(
      source
        .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
        .filter(
          (item): item is WebSearchEngine =>
            item === "tavily" || item === "brave" || item === "metaso" || item === "exa",
        ),
    ),
  )
  if (normalized.length === 0) return [...fallback]
  return normalized
}

const normalizeEngineOrder = (
  order: unknown,
  enabled: WebSearchEngine[],
): WebSearchEngine[] => {
  const normalizedOrder = normalizeEngineList(order, enabled)
  return [
    ...normalizedOrder.filter((engine) => enabled.includes(engine)),
    ...enabled.filter((engine) => !normalizedOrder.includes(engine)),
  ]
}

const normalizeDomains = (text: string) =>
  text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)

const arraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, idx) => item === right[idx])

interface DocumentItem {
  id: number
  originalName: string
  mimeType: string
  fileSize: number
  status: string
  chunkCount: number | null
  createdAt: string
  userId: number | null
}

interface KnowledgeBase {
  id: number
  name: string
  description: string | null
  isPublic: boolean
  status: string
  documentCount: number
  totalChunks: number
  createdAt: string
  updatedAt: string
}

interface KnowledgeBaseDocument {
  id: number
  originalName: string
  mimeType: string
  fileSize: number
  status: string
  chunkCount: number
  addedAt: string
  processingStage?: string
  processingProgress?: number
  errorMessage?: string
}

// 最大文件大小限制（默认100MB，应与后端配置一致）
const MAX_FILE_SIZE_MB = 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// 根据文件大小计算超时时间（基础30秒 + 每10MB增加30秒）
const calculateTimeout = (fileSize: number) => {
  const baseTimeout = 30000
  const additionalTimeout = Math.ceil(fileSize / (10 * 1024 * 1024)) * 30000
  return baseTimeout + additionalTimeout
}

// 获取处理阶段的显示文本
const getStageText = (stage?: string): string => {
  switch (stage) {
    case 'parsing':
      return '解析文档'
    case 'chunking':
      return '分块处理'
    case 'embedding':
      return '生成向量'
    case 'storing':
      return '存储数据'
    case 'done':
      return '完成'
    case 'error':
      return '失败'
    default:
      return ''
  }
}

export function SearchKnowledgePage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
  const { toast } = useToast()
  const { models, isLoading: modelsLoading, fetchAll: fetchModels } = useModelsStore()

  // ---------- 联网搜索（webSearch*）----------
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [enabledEngines, setEnabledEngines] = useState<WebSearchEngine[]>(["tavily"])
  const [engineOrder, setEngineOrder] = useState<WebSearchEngine[]>(["tavily"])
  const [resultLimit, setResultLimit] = useState(4)
  const [domains, setDomains] = useState("")
  const [apiKeyTavilyDraft, setApiKeyTavilyDraft] = useState("")
  const [apiKeyBraveDraft, setApiKeyBraveDraft] = useState("")
  const [apiKeyMetasoDraft, setApiKeyMetasoDraft] = useState("")
  const [apiKeyExaDraft, setApiKeyExaDraft] = useState("")
  const [clearTavily, setClearTavily] = useState(false)
  const [clearBrave, setClearBrave] = useState(false)
  const [clearMetaso, setClearMetaso] = useState(false)
  const [clearExa, setClearExa] = useState(false)
  const [scope, setScope] = useState("webpage")
  const [includeSummary, setIncludeSummary] = useState(false)
  const [includeRaw, setIncludeRaw] = useState(false)
  const [parallelMaxEngines, setParallelMaxEngines] = useState(3)
  const [parallelMaxQueries, setParallelMaxQueries] = useState(2)
  const [parallelTimeoutMs, setParallelTimeoutMs] = useState(12000)
  const [autoBilingual, setAutoBilingual] = useState(true)
  const [autoBilingualMode, setAutoBilingualMode] = useState<WebSearchBilingualMode>("conditional")
  const [autoReadParallelism, setAutoReadParallelism] = useState(2)

  // ---------- RAG 文档解析（rag*）----------
  const [ragEnabled, setRagEnabled] = useState(false)
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

  // ---------- 知识库（knowledgeBase*）----------
  const [kbEnabled, setKbEnabled] = useState(false)
  const [allowAnonymous, setAllowAnonymous] = useState(false)
  const [allowUsers, setAllowUsers] = useState(true)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [kbLoading, setKbLoading] = useState(false)

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newKbName, setNewKbName] = useState("")
  const [newKbDescription, setNewKbDescription] = useState("")
  const [creating, setCreating] = useState(false)

  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [kbDocuments, setKbDocuments] = useState<KnowledgeBaseDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadingFiles, setUploadingFiles] = useState<Array<{
    name: string
    progress: number
    status: 'pending' | 'uploading' | 'success' | 'error'
    error?: string
  }>>([])

  // 批量删除相关状态（详情弹框内）
  const [kbSelectedDocIds, setKbSelectedDocIds] = useState<Set<number>>(new Set())
  const [kbBatchDeleting, setKbBatchDeleting] = useState(false)

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

  const fetchKnowledgeBases = useCallback(async () => {
    setKbLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<KnowledgeBase[]>>('/knowledge-bases/admin')
      if (res.data.success && res.data.data) {
        setKnowledgeBases(res.data.data)
      }
    } catch (e) {
      console.error('Failed to fetch knowledge bases:', e)
    } finally {
      setKbLoading(false)
    }
  }, [])

  const fetchKbDetail = useCallback(async (id: number) => {
    setDocsLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<{
        documents: KnowledgeBaseDocument[]
      }>>(`/knowledge-bases/${id}`)
      if (res.data.success && res.data.data) {
        setKbDocuments(res.data.data.documents || [])
      }
    } catch (e) {
      console.error('Failed to fetch knowledge base detail:', e)
    } finally {
      setDocsLoading(false)
    }
  }, [])

  // 过滤后的文档列表
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const matchesSearch = docSearchQuery === "" ||
        doc.originalName.toLowerCase().includes(docSearchQuery.toLowerCase())
      const matchesStatus = docStatusFilter === "all" || doc.status === docStatusFilter
      return matchesSearch && matchesStatus
    })
  }, [documents, docSearchQuery, docStatusFilter])

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

  const currentEnabledEngines = useMemo(
    () => normalizeEngineList(systemSettings?.webSearchEnabledEngines, ["tavily"]),
    [systemSettings?.webSearchEnabledEngines],
  )
  const currentEngineOrder = useMemo(
    () => normalizeEngineOrder(systemSettings?.webSearchEngineOrder, currentEnabledEngines),
    [systemSettings?.webSearchEngineOrder, currentEnabledEngines],
  )

  const normalizedEngineOrder = useMemo(
    () => normalizeEngineOrder(engineOrder, enabledEngines),
    [engineOrder, enabledEngines],
  )

  const hasMetasoEnabled = enabledEngines.includes("metaso")

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  useEffect(() => {
    fetchModels().catch(() => {})
    fetchKnowledgeBases().catch(() => {})
  }, [fetchModels, fetchKnowledgeBases])

  // 联网搜索设置同步
  useEffect(() => {
    if (!systemSettings) return
    const nextEnabledEngines = normalizeEngineList(systemSettings.webSearchEnabledEngines, ["tavily"])
    const nextEngineOrder = normalizeEngineOrder(systemSettings.webSearchEngineOrder, nextEnabledEngines)

    setWebSearchEnabled(Boolean(systemSettings.webSearchAgentEnable ?? false))
    setEnabledEngines(nextEnabledEngines)
    setEngineOrder(nextEngineOrder)
    setResultLimit(Number(systemSettings.webSearchResultLimit ?? 4))
    setDomains((systemSettings.webSearchDomainFilter ?? []).join("\n"))
    setApiKeyTavilyDraft("")
    setApiKeyBraveDraft("")
    setApiKeyMetasoDraft("")
    setApiKeyExaDraft("")
    setClearTavily(false)
    setClearBrave(false)
    setClearMetaso(false)
    setClearExa(false)
    setScope(systemSettings.webSearchScope || "webpage")
    setIncludeSummary(Boolean(systemSettings.webSearchIncludeSummary ?? false))
    setIncludeRaw(Boolean(systemSettings.webSearchIncludeRaw ?? false))
    setParallelMaxEngines(Number(systemSettings.webSearchParallelMaxEngines ?? 3))
    setParallelMaxQueries(Number(systemSettings.webSearchParallelMaxQueriesPerCall ?? 2))
    setParallelTimeoutMs(Number(systemSettings.webSearchParallelTimeoutMs ?? 12000))
    setAutoBilingual(Boolean(systemSettings.webSearchAutoBilingual ?? true))
    setAutoBilingualMode(systemSettings.webSearchAutoBilingualMode ?? "conditional")
    setAutoReadParallelism(Number(systemSettings.webSearchAutoReadParallelism ?? 2))
  }, [systemSettings])

  // RAG 设置同步
  useEffect(() => {
    if (!systemSettings) return
    setRagEnabled(Boolean(systemSettings.ragEnabled ?? false))
    setSelectedConnectionId(systemSettings.ragEmbeddingConnectionId ?? null)
    setSelectedModelId(systemSettings.ragEmbeddingModelId || "")
    setEmbeddingBatchSize(Number(systemSettings.ragEmbeddingBatchSize ?? 1))
    setEmbeddingConcurrency(Number(systemSettings.ragEmbeddingConcurrency ?? 1))
    setTopK(Number(systemSettings.ragTopK ?? 5))
    setRelevanceThreshold(Number(systemSettings.ragRelevanceThreshold ?? 0.3))
    setMaxContextTokens(Number(systemSettings.ragMaxContextTokens ?? 4000))
    setChunkSize(Number(systemSettings.ragChunkSize ?? 1500))
    setChunkOverlap(Number(systemSettings.ragChunkOverlap ?? 100))
    setMaxFileSizeMb(Number(systemSettings.ragMaxFileSizeMb ?? 50))
    setMaxPages(Number(systemSettings.ragMaxPages ?? 200))
    setRetentionDays(Number(systemSettings.ragRetentionDays ?? 30))
  }, [systemSettings])

  // 知识库设置同步
  useEffect(() => {
    if (!systemSettings) return
    setKbEnabled(Boolean(systemSettings.knowledgeBaseEnabled ?? false))
    setAllowAnonymous(Boolean(systemSettings.knowledgeBaseAllowAnonymous ?? false))
    setAllowUsers(Boolean(systemSettings.knowledgeBaseAllowUsers ?? true))
  }, [systemSettings])

  useEffect(() => {
    if (selectedKb) {
      fetchKbDetail(selectedKb.id)
    }
  }, [selectedKb, fetchKbDetail])

  // 自动轮询处理中的文档状态
  useEffect(() => {
    if (!detailDialogOpen || !selectedKb) return

    const hasPendingDocs = kbDocuments.some(
      (doc) => doc.status === 'pending' || doc.status === 'processing'
    )

    if (!hasPendingDocs) return

    const interval = setInterval(() => {
      fetchKbDetail(selectedKb.id)
      fetchKnowledgeBases() // 同时更新知识库列表的分块数
    }, 5000) // 每5秒刷新一次

    return () => clearInterval(interval)
  }, [detailDialogOpen, selectedKb, kbDocuments, fetchKbDetail, fetchKnowledgeBases])

  // ---------- 联网搜索交互 ----------
  const toggleEngine = (engine: WebSearchEngine, checked: boolean) => {
    setEnabledEngines((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, engine]))
        : prev.filter((item) => item !== engine)
      setEngineOrder((prevOrder) => normalizeEngineOrder(prevOrder, next))
      return next
    })
  }

  const moveEngine = (engine: WebSearchEngine, direction: "up" | "down") => {
    setEngineOrder((prev) => {
      const next = normalizeEngineOrder(prev, enabledEngines)
      const index = next.indexOf(engine)
      if (index < 0) return next
      if (direction === "up" && index === 0) return next
      if (direction === "down" && index === next.length - 1) return next
      const target = direction === "up" ? index - 1 : index + 1
      const copied = [...next]
      ;[copied[index], copied[target]] = [copied[target], copied[index]]
      return copied
    })
  }

  // ---------- RAG 文档管理交互 ----------
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

  // 状态徽章
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      ready: 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
      processing: 'border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
      error: 'border border-destructive/30 bg-destructive/10 text-destructive',
      pending: 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground',
    }
    const labels: Record<string, string> = {
      ready: '就绪',
      processing: '处理中',
      error: '错误',
      pending: '等待中',
    }
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    )
  }

  // 打开文档管理弹框时加载数据
  const openDocDialog = () => {
    setDocDialogOpen(true)
    fetchDocuments()
  }

  const handleModelSelect = (model: ModelItem) => {
    setSelectedConnectionId(model.connectionId)
    setSelectedModelId(model.id)
    setModelSelectOpen(false)
    setModelFilter("")
  }

  // ---------- 知识库交互 ----------
  const handleCreateKb = async () => {
    if (!newKbName.trim()) {
      toast({ title: "请输入知识库名称", variant: "destructive" })
      return
    }

    setCreating(true)
    try {
      const res = await apiHttpClient.post<ApiResponse<KnowledgeBase>>('/knowledge-bases', {
        name: newKbName.trim(),
        description: newKbDescription.trim() || undefined,
        isPublic: true,
      })
      if (res.data.success) {
        toast({ title: "知识库创建成功" })
        setCreateDialogOpen(false)
        setNewKbName("")
        setNewKbDescription("")
        fetchKnowledgeBases()
      } else {
        throw new Error(res.data.error || 'Failed')
      }
    } catch (e: any) {
      toast({
        title: "创建失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteKb = async (id: number) => {
    if (!confirm('确定要删除这个知识库吗？')) return

    try {
      const res = await apiHttpClient.delete<ApiResponse<any>>(`/knowledge-bases/${id}`)
      if (res.data.success) {
        toast({ title: "知识库已删除" })
        fetchKnowledgeBases()
        if (selectedKb?.id === id) {
          setDetailDialogOpen(false)
          setSelectedKb(null)
        }
      }
    } catch (e: any) {
      toast({
        title: "删除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const handleUploadDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!selectedKb || !e.target.files?.length) return

    const files = Array.from(e.target.files)

    // 文件大小预检查
    const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE_BYTES)
    if (oversizedFiles.length > 0) {
      toast({
        title: "部分文件过大",
        description: `${oversizedFiles.map(f => f.name).join(', ')} 超过限制 ${MAX_FILE_SIZE_MB}MB，已跳过这些文件。`,
        variant: "destructive",
      })
    }

    // 过滤掉超大文件
    const validFiles = files.filter(f => f.size <= MAX_FILE_SIZE_BYTES)
    if (validFiles.length === 0) {
      e.target.value = ''
      return
    }

    // 检查最大批量上传数量
    const MAX_FILES_PER_BATCH = 20
    if (validFiles.length > MAX_FILES_PER_BATCH) {
      toast({
        title: "文件数量超限",
        description: `单次最多上传 ${MAX_FILES_PER_BATCH} 个文件，请分批上传。`,
        variant: "destructive",
      })
      e.target.value = ''
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setUploadingFiles(validFiles.map(f => ({
      name: f.name,
      progress: 0,
      status: 'pending' as const
    })))

    try {
      const formData = new FormData()
      validFiles.forEach(file => {
        formData.append('files', file)
      })

      // 根据所有文件总大小计算超时时间
      const totalSize = validFiles.reduce((sum, f) => sum + f.size, 0)
      const timeout = calculateTimeout(totalSize)

      const res = await apiHttpClient.post<ApiResponse<{
        results: Array<{
          fileName: string
          documentId?: number
          status?: string
          error?: string
        }>
        summary: {
          total: number
          success: number
          failed: number
        }
      }>>(
        `/knowledge-bases/${selectedKb.id}/documents/batch-upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
              setUploadProgress(percent)
              // 更新所有文件为上传中状态
              setUploadingFiles(prev => prev.map(f => ({
                ...f,
                progress: percent,
                status: 'uploading' as const
              })))
            }
          }
        }
      )

      if (res.data.success && res.data.data) {
        const { results, summary } = res.data.data

        // 更新每个文件的最终状态
        setUploadingFiles(prev => prev.map(f => {
          const result = results.find(r => r.fileName === f.name)
          if (result?.documentId) {
            return { ...f, progress: 100, status: 'success' as const }
          } else if (result?.error) {
            return { ...f, progress: 100, status: 'error' as const, error: result.error }
          }
          return f
        }))

        if (summary.failed > 0) {
          toast({
            title: `上传完成：${summary.success} 成功，${summary.failed} 失败`,
            description: "部分文档上传失败，请检查文件格式或稍后重试",
            variant: summary.success > 0 ? "default" : "destructive"
          })
        } else {
          toast({
            title: `${summary.success} 个文档上传成功`,
            description: "正在解析中，请稍候..."
          })
        }

        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()

        // 延迟清除上传状态，让用户看到结果
        setTimeout(() => {
          setUploading(false)
          setUploadProgress(0)
          setUploadingFiles([])
        }, 2000)
      } else {
        throw new Error(res.data.error || 'Upload failed')
      }
    } catch (e: any) {
      // 区分超时错误和其他错误
      let errorMessage = e?.message || "请稍后重试"
      if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
        errorMessage = `上传超时，文件较大可能需要更长时间。请检查网络连接后重试。`
      }
      toast({
        title: "上传失败",
        description: errorMessage,
        variant: "destructive",
      })
      setUploading(false)
      setUploadProgress(0)
      setUploadingFiles([])
    } finally {
      e.target.value = ''
    }
  }

  const handleRemoveDocument = async (docId: number) => {
    if (!selectedKb) return

    try {
      const res = await apiHttpClient.delete<ApiResponse<any>>(
        `/knowledge-bases/${selectedKb.id}/documents/${docId}`
      )
      if (res.data.success) {
        toast({ title: "文档已移除" })
        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()
      }
    } catch (e: any) {
      toast({
        title: "移除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const handleBatchRemoveDocuments = async () => {
    if (!selectedKb || kbSelectedDocIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${kbSelectedDocIds.size} 个文档吗？`)) return

    setKbBatchDeleting(true)
    try {
      const res = await apiHttpClient.post<ApiResponse<any>>(
        `/knowledge-bases/${selectedKb.id}/documents/batch-remove`,
        { documentIds: Array.from(kbSelectedDocIds) }
      )
      if (res.data.success) {
        toast({ title: `已删除 ${res.data.data.deleted} 个文档` })
        setKbSelectedDocIds(new Set())
        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()
      }
    } catch (e: any) {
      toast({
        title: "批量删除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setKbBatchDeleting(false)
    }
  }

  const toggleKbSelectDoc = (docId: number) => {
    setKbSelectedDocIds(prev => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const toggleKbSelectAll = () => {
    if (kbSelectedDocIds.size === kbDocuments.length) {
      setKbSelectedDocIds(new Set())
    } else {
      setKbSelectedDocIds(new Set(kbDocuments.map(d => d.id)))
    }
  }

  const handleRefreshStats = async (kbId: number) => {
    try {
      const res = await apiHttpClient.post<ApiResponse<any>>(
        `/knowledge-bases/${kbId}/refresh-stats`
      )
      if (res.data.success) {
        toast({ title: "统计信息已刷新" })
        fetchKnowledgeBases()
      }
    } catch (e: any) {
      toast({
        title: "刷新失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
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
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  // ---------- 联网搜索校验与保存 ----------
  const limitRange = { min: 1, max: 10 }
  const parallelEngineRange = { min: 1, max: 4 }
  const parallelQueryRange = { min: 1, max: 3 }
  const parallelTimeoutRange = { min: 1000, max: 120000 }
  const autoReadParallelismRange = { min: 1, max: 4 }

  const limitValid = resultLimit >= limitRange.min && resultLimit <= limitRange.max
  const parallelMaxEnginesValid =
    parallelMaxEngines >= parallelEngineRange.min && parallelMaxEngines <= parallelEngineRange.max
  const parallelMaxQueriesValid =
    parallelMaxQueries >= parallelQueryRange.min && parallelMaxQueries <= parallelQueryRange.max
  const parallelTimeoutValid =
    parallelTimeoutMs >= parallelTimeoutRange.min && parallelTimeoutMs <= parallelTimeoutRange.max
  const autoReadParallelismValid =
    autoReadParallelism >= autoReadParallelismRange.min &&
    autoReadParallelism <= autoReadParallelismRange.max

  const webSearchChanged =
    webSearchEnabled !== Boolean(systemSettings.webSearchAgentEnable ?? false) ||
    !arraysEqual(enabledEngines, currentEnabledEngines) ||
    !arraysEqual(normalizedEngineOrder, currentEngineOrder) ||
    resultLimit !== Number(systemSettings.webSearchResultLimit ?? 4) ||
    domains !== (systemSettings.webSearchDomainFilter ?? []).join("\n") ||
    scope !== (systemSettings.webSearchScope || "webpage") ||
    includeSummary !== Boolean(systemSettings.webSearchIncludeSummary ?? false) ||
    includeRaw !== Boolean(systemSettings.webSearchIncludeRaw ?? false) ||
    parallelMaxEngines !== Number(systemSettings.webSearchParallelMaxEngines ?? 3) ||
    parallelMaxQueries !== Number(systemSettings.webSearchParallelMaxQueriesPerCall ?? 2) ||
    parallelTimeoutMs !== Number(systemSettings.webSearchParallelTimeoutMs ?? 12000) ||
    autoBilingual !== Boolean(systemSettings.webSearchAutoBilingual ?? true) ||
    autoBilingualMode !== (systemSettings.webSearchAutoBilingualMode ?? "conditional") ||
    autoReadParallelism !== Number(systemSettings.webSearchAutoReadParallelism ?? 2) ||
    apiKeyTavilyDraft.trim() !== "" ||
    apiKeyBraveDraft.trim() !== "" ||
    apiKeyMetasoDraft.trim() !== "" ||
    apiKeyExaDraft.trim() !== "" ||
    clearTavily ||
    clearBrave ||
    clearMetaso ||
    clearExa

  const webSearchValid =
    enabledEngines.length > 0 &&
    limitValid &&
    parallelMaxEnginesValid &&
    parallelMaxQueriesValid &&
    parallelTimeoutValid &&
    autoReadParallelismValid

  const saveWebSearch = async () => {
    if (!webSearchValid) return

    const payload: Record<string, any> = {
      webSearchAgentEnable: webSearchEnabled,
      webSearchEnabledEngines: enabledEngines,
      webSearchEngineOrder: normalizedEngineOrder,
      webSearchResultLimit: Math.max(limitRange.min, Math.min(limitRange.max, Math.round(resultLimit))),
      webSearchDomainFilter: normalizeDomains(domains),
      webSearchScope: scope,
      webSearchIncludeSummary: includeSummary,
      webSearchIncludeRaw: includeRaw,
      webSearchParallelMaxEngines: Math.max(
        parallelEngineRange.min,
        Math.min(Math.min(parallelEngineRange.max, enabledEngines.length), Math.round(parallelMaxEngines)),
      ),
      webSearchParallelMaxQueriesPerCall: Math.max(
        parallelQueryRange.min,
        Math.min(parallelQueryRange.max, Math.round(parallelMaxQueries)),
      ),
      webSearchParallelTimeoutMs: Math.max(
        parallelTimeoutRange.min,
        Math.min(parallelTimeoutRange.max, Math.round(parallelTimeoutMs)),
      ),
      webSearchParallelMergeStrategy: mergeStrategy,
      webSearchAutoBilingual: autoBilingual,
      webSearchAutoBilingualMode: autoBilingualMode,
      webSearchAutoReadParallelism: Math.max(
        autoReadParallelismRange.min,
        Math.min(autoReadParallelismRange.max, Math.round(autoReadParallelism)),
      ),
    }

    if (apiKeyTavilyDraft.trim()) {
      payload.webSearchApiKeyTavily = apiKeyTavilyDraft.trim()
    } else if (clearTavily) {
      payload.webSearchApiKeyTavily = ""
    }
    if (apiKeyBraveDraft.trim()) {
      payload.webSearchApiKeyBrave = apiKeyBraveDraft.trim()
    } else if (clearBrave) {
      payload.webSearchApiKeyBrave = ""
    }
    if (apiKeyMetasoDraft.trim()) {
      payload.webSearchApiKeyMetaso = apiKeyMetasoDraft.trim()
    } else if (clearMetaso) {
      payload.webSearchApiKeyMetaso = ""
    }
    if (apiKeyExaDraft.trim()) {
      payload.webSearchApiKeyExa = apiKeyExaDraft.trim()
    } else if (clearExa) {
      payload.webSearchApiKeyExa = ""
    }

    await updateSystemSettings(payload)
    setApiKeyTavilyDraft("")
    setApiKeyBraveDraft("")
    setApiKeyMetasoDraft("")
    setApiKeyExaDraft("")
    setClearTavily(false)
    setClearBrave(false)
    setClearMetaso(false)
    setClearExa(false)
    toast({ title: "联网搜索设置已保存" })
  }

  const handleSaveRag = async () => {
    try {
      await updateSystemSettings({
        ragEnabled,
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

  const handleSaveKb = async () => {
    try {
      await updateSystemSettings({
        knowledgeBaseEnabled: kbEnabled,
        knowledgeBaseAllowAnonymous: allowAnonymous,
        knowledgeBaseAllowUsers: allowUsers,
      } as any)
      toast({ title: "知识库设置已保存" })
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
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <Search className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">搜索与知识库</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            配置联网搜索、文档解析与知识库
          </CardDescription>
        </div>
      </div>

      {/* ① 联网搜索 */}
      <FeatureCard
        icon={Globe}
        title="联网搜索"
        description="在回答前自动检索网页，支持多引擎并行"
        enabled={webSearchEnabled}
        onEnabledChange={setWebSearchEnabled}
        more={
          <div className="space-y-3">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="web-search-parallel-engines">
                  并行引擎上限（1-3）
                </label>
                <Input
                  id="web-search-parallel-engines"
                  type="text"
                  value={parallelMaxEngines}
                  onChange={(e) => setParallelMaxEngines((prev) => parseNumericInput(e.target.value, prev))}
                  className={!parallelMaxEnginesValid ? "border-destructive" : undefined}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="web-search-parallel-queries">
                  单次调用查询扩展数（1-3）
                </label>
                <Input
                  id="web-search-parallel-queries"
                  type="text"
                  value={parallelMaxQueries}
                  onChange={(e) => setParallelMaxQueries((prev) => parseNumericInput(e.target.value, prev))}
                  className={!parallelMaxQueriesValid ? "border-destructive" : undefined}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="web-search-parallel-timeout">
                  并行检索超时（毫秒）
                </label>
                <Input
                  id="web-search-parallel-timeout"
                  type="text"
                  value={parallelTimeoutMs}
                  onChange={(e) => setParallelTimeoutMs((prev) => parseNumericInput(e.target.value, prev))}
                  className={!parallelTimeoutValid ? "border-destructive" : undefined}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">自动双语检索</p>
                  <p className="text-xs text-muted-foreground">提示中涉及跨语种信息时自动补充中英文查询。</p>
                </div>
                <Switch checked={autoBilingual} onCheckedChange={(v) => setAutoBilingual(!!v)} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="web-search-bilingual-mode">
                  双语扩展策略
                </label>
                <Select value={autoBilingualMode} onValueChange={(value) => setAutoBilingualMode(value as WebSearchBilingualMode)}>
                  <SelectTrigger id="web-search-bilingual-mode">
                    <SelectValue placeholder="选择策略" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">关闭</SelectItem>
                    <SelectItem value="conditional">按语义自动扩展</SelectItem>
                    <SelectItem value="always">始终扩展</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="text-sm font-medium" htmlFor="web-search-auto-read-parallelism">
                  自动网页读取并发（1-4）
                </label>
                <Input
                  id="web-search-auto-read-parallelism"
                  type="text"
                  value={autoReadParallelism}
                  onChange={(e) => setAutoReadParallelism((prev) => parseNumericInput(e.target.value, prev))}
                  className={!autoReadParallelismValid ? "border-destructive" : undefined}
                />
                <p className="text-xs text-muted-foreground">融合策略固定为 {mergeStrategy}，目前无需额外切换。</p>
              </div>
            </div>

            {hasMetasoEnabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="web-search-scope">
                    Metaso 默认搜索范围
                  </label>
                  <Select value={scope} onValueChange={(value) => setScope(value)}>
                    <SelectTrigger id="web-search-scope">
                      <SelectValue placeholder="选择搜索范围" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webpage">网页</SelectItem>
                      <SelectItem value="document">文档</SelectItem>
                      <SelectItem value="paper">论文</SelectItem>
                      <SelectItem value="image">图片</SelectItem>
                      <SelectItem value="video">视频</SelectItem>
                      <SelectItem value="podcast">播客</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">召回增强（includeSummary）</p>
                      <p className="text-xs text-muted-foreground">适度提升召回，可能略增延迟。</p>
                    </div>
                    <Switch checked={includeSummary} onCheckedChange={(v) => setIncludeSummary(!!v)} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">抓取原文（includeRawContent）</p>
                      <p className="text-xs text-muted-foreground">可能增加流量与时延，默认关闭。</p>
                    </div>
                    <Switch checked={includeRaw} onCheckedChange={(v) => setIncludeRaw(!!v)} />
                  </div>
                </div>
              </div>
            )}
          </div>
        }
        footer={
          <div className="flex justify-end">
            <Button
              onClick={saveWebSearch}
              disabled={!webSearchChanged || !webSearchValid}
            >
              保存联网搜索设置
            </Button>
          </div>
        }
      >
        <div className="space-y-3 rounded-lg border border-border/70 p-3">
          <div>
            <p className="text-sm font-medium">启用搜索引擎（可多选）</p>
            <p className="text-xs text-muted-foreground">至少保留一个引擎，运行时按下方顺序优先并行调度。</p>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {ENGINE_OPTIONS.map((engine) => {
              const checked = enabledEngines.includes(engine.value)
              const hasKey =
                engine.value === "tavily"
                  ? systemSettings.webSearchHasApiKeyTavily
                  : engine.value === "brave"
                    ? systemSettings.webSearchHasApiKeyBrave
                    : engine.value === "metaso"
                      ? systemSettings.webSearchHasApiKeyMetaso
                      : systemSettings.webSearchHasApiKeyExa
              return (
                <label
                  key={engine.value}
                  className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleEngine(engine.value, value === true)}
                  />
                  <span className="flex-1 text-sm">
                    {engine.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {hasKey ? "已配置 Key" : "未配置 Key"}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {enabledEngines.length === 0 && (
            <p className="text-xs text-destructive">至少需要启用一个搜索引擎。</p>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border/70 p-3">
          <div>
            <p className="text-sm font-medium">引擎优先顺序</p>
            <p className="text-xs text-muted-foreground">并行调度时优先保留前序引擎。</p>
          </div>
          <div className="space-y-2">
            {normalizedEngineOrder.map((engine, index) => {
              const label = ENGINE_OPTIONS.find((item) => item.value === engine)?.label || engine
              return (
                <div
                  key={engine}
                  className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                >
                  <span className="text-sm">
                    #{index + 1} {label}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveEngine(engine, "up")}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveEngine(engine, "down")}
                      disabled={index === normalizedEngineOrder.length - 1}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="web-search-limit">
            每次融合结果数（1-10）
          </label>
          <Input
            id="web-search-limit"
            type="text"
            value={resultLimit}
            onChange={(e) => setResultLimit((prev) => parseNumericInput(e.target.value, prev))}
            className={!limitValid ? "border-destructive" : undefined}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="web-search-domains">
            域名白名单（可选，每行一个，留空不过滤）
          </label>
          <Textarea
            id="web-search-domains"
            rows={4}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder={"example.com\nanother-site.org"}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium" htmlFor="web-search-key-tavily">
                Tavily API Key
              </label>
              <span className="text-xs text-muted-foreground">
                {systemSettings.webSearchHasApiKeyTavily && !clearTavily ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="web-search-key-tavily"
                type="password"
                value={apiKeyTavilyDraft}
                placeholder="留空表示不修改"
                onChange={(e) => {
                  setApiKeyTavilyDraft(e.target.value)
                  if (clearTavily) setClearTavily(false)
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKeyTavilyDraft("")
                  setClearTavily(true)
                }}
                disabled={!systemSettings.webSearchHasApiKeyTavily && !clearTavily}
              >
                清除
              </Button>
            </div>
            {clearTavily && <p className="text-xs text-destructive">保存后将删除 Tavily Key。</p>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium" htmlFor="web-search-key-brave">
                Brave API Key
              </label>
              <span className="text-xs text-muted-foreground">
                {systemSettings.webSearchHasApiKeyBrave && !clearBrave ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="web-search-key-brave"
                type="password"
                value={apiKeyBraveDraft}
                placeholder="留空表示不修改"
                onChange={(e) => {
                  setApiKeyBraveDraft(e.target.value)
                  if (clearBrave) setClearBrave(false)
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKeyBraveDraft("")
                  setClearBrave(true)
                }}
                disabled={!systemSettings.webSearchHasApiKeyBrave && !clearBrave}
              >
                清除
              </Button>
            </div>
            {clearBrave && <p className="text-xs text-destructive">保存后将删除 Brave Key。</p>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium" htmlFor="web-search-key-metaso">
                Metaso API Key
              </label>
              <span className="text-xs text-muted-foreground">
                {systemSettings.webSearchHasApiKeyMetaso && !clearMetaso ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="web-search-key-metaso"
                type="password"
                value={apiKeyMetasoDraft}
                placeholder="留空表示不修改"
                onChange={(e) => {
                  setApiKeyMetasoDraft(e.target.value)
                  if (clearMetaso) setClearMetaso(false)
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKeyMetasoDraft("")
                  setClearMetaso(true)
                }}
                disabled={!systemSettings.webSearchHasApiKeyMetaso && !clearMetaso}
              >
                清除
              </Button>
            </div>
            {clearMetaso && <p className="text-xs text-destructive">保存后将删除 Metaso Key。</p>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium" htmlFor="web-search-key-exa">
                Exa API Key
              </label>
              <span className="text-xs text-muted-foreground">
                {systemSettings.webSearchHasApiKeyExa && !clearExa ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="web-search-key-exa"
                type="password"
                value={apiKeyExaDraft}
                placeholder="留空表示不修改"
                onChange={(e) => {
                  setApiKeyExaDraft(e.target.value)
                  if (clearExa) setClearExa(false)
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKeyExaDraft("")
                  setClearExa(true)
                }}
                disabled={!systemSettings.webSearchHasApiKeyExa && !clearExa}
              >
                清除
              </Button>
            </div>
            {clearExa && <p className="text-xs text-destructive">保存后将删除 Exa Key。</p>}
          </div>
        </div>
      </FeatureCard>

      {/* ② RAG 文档解析 */}
      <FeatureCard
        icon={FileText}
        title="RAG 文档解析"
        description="附加文档后，AI 基于文档内容回答"
        enabled={ragEnabled}
        onEnabledChange={setRagEnabled}
        more={
          ragEnabled ? (
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
            <Button onClick={handleSaveRag}>保存设置</Button>
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

        {ragEnabled && (
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

      {/* ③ 知识库 */}
      <FeatureCard
        icon={BookOpen}
        title="知识库"
        description="创建和管理持久化知识库，供所有用户使用"
        enabled={kbEnabled}
        onEnabledChange={setKbEnabled}
        footer={
          <div className="flex justify-end">
            <Button onClick={handleSaveKb}>保存设置</Button>
          </div>
        }
      >
        {kbEnabled && (
          <>
            <div className="space-y-3 border-b border-border py-4">
              <h4 className="font-medium">用户权限</h4>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">允许匿名用户使用</p>
                  <p className="text-xs text-muted-foreground">未登录用户是否可以使用知识库</p>
                </div>
                <Switch checked={allowAnonymous} onCheckedChange={setAllowAnonymous} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">允许注册用户使用</p>
                  <p className="text-xs text-muted-foreground">已登录用户是否可以使用知识库</p>
                </div>
                <Switch checked={allowUsers} onCheckedChange={setAllowUsers} />
              </div>
            </div>

            <div className="space-y-3 pt-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">知识库列表</h4>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchKnowledgeBases()}
                    disabled={kbLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${kbLoading ? 'animate-spin' : ''}`} />
                    刷新
                  </Button>
                  <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    新建知识库
                  </Button>
                </div>
              </div>

              {kbLoading && knowledgeBases.length === 0 ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : knowledgeBases.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-border py-8 text-center text-muted-foreground">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>暂无知识库</p>
                  <p className="text-sm">点击上方按钮创建第一个知识库</p>
                </div>
              ) : (
                <div className="v2-table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>文档数</TableHead>
                      <TableHead>分块数</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {knowledgeBases.map((kb) => (
                      <TableRow key={kb.id}>
                        <TableCell>
                          <button
                            className="font-medium hover:underline text-left"
                            onClick={() => {
                              setSelectedKb(kb)
                              setDetailDialogOpen(true)
                            }}
                          >
                            {kb.name}
                          </button>
                          {kb.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {kb.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>{kb.documentCount}</TableCell>
                        <TableCell>{kb.totalChunks}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded ${kb.status === 'active'
                            ? 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]'
                            : 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground'
                            }`}>
                            {kb.status === 'active' ? '启用' : '禁用'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(kb.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedKb(kb)
                                  setDetailDialogOpen(true)
                                }}
                              >
                                <FileText className="h-4 w-4 mr-2" />
                                查看文档
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleRefreshStats(kb.id)}
                              >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                刷新统计
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDeleteKb(kb.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </div>
          </>
        )}
      </FeatureCard>

      {/* RAG 文档管理弹框 */}
      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>文档管理</DialogTitle>
                <DialogDescription>
                  管理所有用户上传的文档，支持批量删除（包含向量数据清理和空间回收）
                </DialogDescription>
              </div>
              <Button variant="outline" size="sm" onClick={fetchDocuments} disabled={docLoading}>
                <RefreshCw className={cn("h-4 w-4 mr-1", docLoading && "animate-spin")} />
                刷新
              </Button>
            </div>
          </DialogHeader>

          <div className="flex items-center gap-3 py-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索文档名..."
                value={docSearchQuery}
                onChange={(e) => setDocSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={docStatusFilter} onValueChange={setDocStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="ready">就绪</SelectItem>
                <SelectItem value="processing">处理中</SelectItem>
                <SelectItem value="error">错误</SelectItem>
                <SelectItem value="pending">等待中</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              共 {filteredDocuments.length} 个文档
            </span>
          </div>

          {selectedDocIds.size > 0 && (
            <div className="flex items-center gap-3 py-2 px-3 bg-muted rounded-lg">
              <span className="text-sm">已选择 {selectedDocIds.size} 个文档</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBatchDeleteDocs}
                disabled={batchDeleting}
              >
                {batchDeleting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                批量删除
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDocIds(new Set())}
              >
                取消选择
              </Button>
            </div>
          )}

          <div className="border rounded-lg overflow-auto max-h-[400px]">
            {docLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>暂无文档</p>
                <p className="text-sm">用户上传的文档将显示在这里</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedDocIds.size === filteredDocuments.length && filteredDocuments.length > 0}
                        onCheckedChange={toggleSelectAllDocs}
                      />
                    </TableHead>
                    <TableHead>文件名</TableHead>
                    <TableHead className="w-[80px]">大小</TableHead>
                    <TableHead className="w-[80px]">状态</TableHead>
                    <TableHead className="w-[80px]">分块数</TableHead>
                    <TableHead className="w-[140px]">上传时间</TableHead>
                    <TableHead className="w-[60px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedDocIds.has(doc.id)}
                          onCheckedChange={() => toggleSelectDoc(doc.id)}
                        />
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <span className="truncate block" title={doc.originalName}>
                          {doc.originalName}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatFileSize(doc.fileSize)}
                      </TableCell>
                      <TableCell>{getStatusBadge(doc.status)}</TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {doc.chunkCount ?? '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(doc.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteSingleDoc(doc.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 创建知识库对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建知识库</DialogTitle>
            <DialogDescription>
              创建一个新的知识库，然后可以向其中添加文档
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">名称</label>
              <Input
                placeholder="输入知识库名称"
                value={newKbName}
                onChange={(e) => setNewKbName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">描述（可选）</label>
              <Input
                placeholder="输入知识库描述"
                value={newKbDescription}
                onChange={(e) => setNewKbDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateKb} disabled={creating}>
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 知识库详情对话框 */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="v2-slide-over left-auto right-0 top-0 flex h-[100dvh] max-h-none w-[min(420px,100vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{selectedKb?.name}</DialogTitle>
            <DialogDescription>
              {selectedKb?.description || "管理知识库中的文档"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  共 {kbDocuments.length} 个文档
                </span>
                <div>
                  <input
                    type="file"
                    id="kb-upload"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls"
                    onChange={handleUploadDocument}
                    disabled={uploading}
                    multiple
                  />
                  <Button
                    size="sm"
                    onClick={() => document.getElementById('kb-upload')?.click()}
                    disabled={uploading}
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    {uploading ? "上传中..." : "上传文档"}
                  </Button>
                </div>
              </div>

              {uploading && uploadingFiles.length > 0 && (
                <div className="p-3 border rounded-lg bg-muted/50 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      正在上传 {uploadingFiles.length} 个文件
                    </span>
                    <span className="text-muted-foreground">
                      {uploadProgress < 100 ? `${uploadProgress}%` : '处理中...'}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="max-h-[150px] overflow-y-auto space-y-1">
                    {uploadingFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between text-xs">
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <span className={
                          file.status === 'success' ? 'text-[hsl(var(--success))]' :
                          file.status === 'error' ? 'text-destructive' :
                          'text-muted-foreground'
                        }>
                          {file.status === 'pending' && '等待中'}
                          {file.status === 'uploading' && '上传中'}
                          {file.status === 'success' && (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              成功
                            </span>
                          )}
                          {file.status === 'error' && (
                            <span className="inline-flex items-center gap-1">
                              <XCircle className="h-3 w-3" />
                              {file.error || '失败'}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  {uploadProgress === 100 && uploadingFiles.every(f => f.status === 'uploading') && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      文件已上传，正在等待服务器处理...
                    </p>
                  )}
                </div>
              )}
            </div>

            {docsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : kbDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>暂无文档</p>
                <p className="text-sm">上传文档以构建知识库</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={kbSelectedDocIds.size === kbDocuments.length && kbDocuments.length > 0}
                      onCheckedChange={toggleKbSelectAll}
                    />
                    <span className="text-sm text-muted-foreground">
                      {kbSelectedDocIds.size > 0 ? `已选择 ${kbSelectedDocIds.size} 项` : '全选'}
                    </span>
                  </div>
                  {kbSelectedDocIds.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBatchRemoveDocuments}
                      disabled={kbBatchDeleting}
                    >
                      {kbBatchDeleting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          删除中...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-1" />
                          批量删除 ({kbSelectedDocIds.size})
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>文件名</TableHead>
                        <TableHead>大小</TableHead>
                        <TableHead>分块</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kbDocuments.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <Checkbox
                              checked={kbSelectedDocIds.has(doc.id)}
                              onCheckedChange={() => toggleKbSelectDoc(doc.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate max-w-[200px]">{doc.originalName}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                          <TableCell>{doc.chunkCount}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded ${doc.status === 'ready'
                                  ? 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]'
                                  : doc.status === 'processing'
                                    ? 'border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]'
                                    : doc.status === 'error'
                                      ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                                      : 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground'
                                  }`}>
                                  {doc.status === 'ready' ? '就绪' :
                                    doc.status === 'processing' ? '处理中' :
                                      doc.status === 'error' ? '错误' :
                                        doc.status === 'pending' ? '等待中' : doc.status}
                                </span>
                                {(doc.status === 'processing' || doc.status === 'pending') && (
                                  <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--warning))]" />
                                )}
                              </div>
                              {(doc.status === 'processing' || doc.status === 'pending') && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>{getStageText(doc.processingStage) || '准备中'}</span>
                                    {typeof doc.processingProgress === 'number' && (
                                      <span>({doc.processingProgress}%)</span>
                                    )}
                                  </div>
                                  {typeof doc.processingProgress === 'number' && (
                                    <div className="h-1.5 w-20 rounded bg-muted">
                                      <div
                                        className="h-1.5 rounded bg-[hsl(var(--warning))] transition-all"
                                        style={{ width: `${Math.min(100, doc.processingProgress)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                              {doc.status === 'error' && doc.errorMessage && (
                                <p className="text-xs text-destructive truncate max-w-[150px]" title={doc.errorMessage}>
                                  {doc.errorMessage}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleRemoveDocument(doc.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
