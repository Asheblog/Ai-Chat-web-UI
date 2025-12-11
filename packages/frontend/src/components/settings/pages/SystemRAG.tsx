"use client"

import { useEffect, useState } from "react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { FileText, AlertCircle } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function SystemRAGPage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(false)
  const [engine, setEngine] = useState<'openai' | 'ollama'>('openai')
  const [model, setModel] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [topK, setTopK] = useState(5)
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.3)
  const [maxContextTokens, setMaxContextTokens] = useState(4000)
  const [chunkSize, setChunkSize] = useState(1500)
  const [chunkOverlap, setChunkOverlap] = useState(100)
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(50)
  const [retentionDays, setRetentionDays] = useState(30)

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  useEffect(() => {
    if (!systemSettings) return
    setEnabled(Boolean(systemSettings.ragEnabled ?? false))
    setEngine((systemSettings.ragEmbeddingEngine as 'openai' | 'ollama') || 'openai')
    setModel(systemSettings.ragEmbeddingModel || '')
    setApiUrl(systemSettings.ragEmbeddingApiUrl || '')
    setTopK(Number(systemSettings.ragTopK ?? 5))
    setRelevanceThreshold(Number(systemSettings.ragRelevanceThreshold ?? 0.3))
    setMaxContextTokens(Number(systemSettings.ragMaxContextTokens ?? 4000))
    setChunkSize(Number(systemSettings.ragChunkSize ?? 1500))
    setChunkOverlap(Number(systemSettings.ragChunkOverlap ?? 100))
    setMaxFileSizeMb(Number(systemSettings.ragMaxFileSizeMb ?? 50))
    setRetentionDays(Number(systemSettings.ragRetentionDays ?? 30))
  }, [systemSettings])

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
        ragEmbeddingEngine: engine,
        ragEmbeddingModel: model || undefined,
        ragEmbeddingApiUrl: apiUrl || undefined,
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

  const defaultModel = engine === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'

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
          启用 RAG 需要配置 Embedding API。OpenAI 需要设置 <code className="text-xs bg-muted px-1 py-0.5 rounded">OPENAI_API_KEY</code> 环境变量；
          Ollama 需要配置 API URL（如 <code className="text-xs bg-muted px-1 py-0.5 rounded">http://localhost:11434</code>）。
          修改设置后需要重启后端才能生效。
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
            {/* Embedding 引擎 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Embedding 引擎</label>
                <Select value={engine} onValueChange={(v) => setEngine(v as 'openai' | 'ollama')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="ollama">Ollama (本地)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {engine === 'openai' ? '需要 OPENAI_API_KEY 环境变量' : '需要本地运行 Ollama 服务'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Embedding 模型</label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={defaultModel}
                />
                <p className="text-xs text-muted-foreground">
                  留空使用默认: {defaultModel}
                </p>
              </div>
            </div>

            {/* API URL (Ollama) */}
            {engine === 'ollama' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Ollama API URL</label>
                <Input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <p className="text-xs text-muted-foreground">
                  Ollama 服务地址，留空使用 OLLAMA_API_URL 环境变量
                </p>
              </div>
            )}

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
