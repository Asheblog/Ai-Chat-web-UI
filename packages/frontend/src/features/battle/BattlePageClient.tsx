'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CustomRequestEditor } from '@/components/chat/custom-request-editor'
import { ModelSelector } from '@/components/model-selector'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { useToast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { useSettingsStore } from '@/store/settings-store'
import type { BattleResult, BattleRunDetail, BattleRunSummary } from '@/types'
import { createBattleShare, deleteBattleRun, getBattleRun, listBattleRuns, streamBattle } from '@/features/battle/api'

const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'connection',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
])

type ModelConfigState = {
  key: string
  model: ModelItem
  webSearchEnabled: boolean
  pythonEnabled: boolean
  customBody: string
  customHeaders: Array<{ name: string; value: string }>
  customBodyError?: string | null
  advancedOpen: boolean
}

const normalizeThreshold = (value: string, fallback = 0.8) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

const normalizeInteger = (value: string, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const parseCustomBody = (raw: string) => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { value: undefined, error: null }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: undefined, error: '自定义请求体必须是 JSON 对象' }
    }
    return { value: parsed as Record<string, any>, error: null }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : '自定义请求体解析失败'
    return { value: undefined, error: message }
  }
}

const sanitizeHeaders = (headers: Array<{ name: string; value: string }>) => {
  const sanitized: Array<{ name: string; value: string }> = []
  for (const item of headers) {
    const name = (item?.name || '').trim()
    const value = (item?.value || '').trim()
    if (!name && !value) continue
    if (!name) return { ok: false, reason: '请输入请求头名称', headers: [] as Array<{ name: string; value: string }> }
    if (name.length > 64) return { ok: false, reason: '请求头名称需 ≤ 64 字符', headers: [] as Array<{ name: string; value: string }> }
    if (value.length > 2048) return { ok: false, reason: '请求头值需 ≤ 2048 字符', headers: [] as Array<{ name: string; value: string }> }
    const lower = name.toLowerCase()
    if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
      return { ok: false, reason: '敏感或受保护的请求头无法覆盖，请更换名称', headers: [] as Array<{ name: string; value: string }> }
    }
    const existingIdx = sanitized.findIndex((header) => header.name.toLowerCase() === lower)
    if (existingIdx >= 0) sanitized.splice(existingIdx, 1)
    if (!value) continue
    sanitized.push({ name, value })
  }
  return { ok: true, headers: sanitized }
}

const buildModelStatsMap = (summary: BattleRunSummary['summary'] | null) => {
  const map = new Map<string, BattleRunSummary['summary']['modelStats'][number]>()
  if (!summary) return map
  const items = Array.isArray(summary.modelStats) ? summary.modelStats : []
  for (const item of items) {
    const key = `${item.connectionId ?? 'global'}:${item.rawId ?? item.modelId}`
    map.set(key, item)
  }
  return map
}

export function BattlePageClient() {
  const { toast } = useToast()
  const { models, fetchAll } = useModelsStore()
  const { systemSettings, fetchSystemSettings, settingsLoading } = useSettingsStore((state) => ({
    systemSettings: state.systemSettings,
    fetchSystemSettings: state.fetchSystemSettings,
    settingsLoading: state.isLoading,
  }))
  const settingsRequestedRef = useRef(false)

  const [prompt, setPrompt] = useState('')
  const [expectedAnswer, setExpectedAnswer] = useState('')
  const [judgeModel, setJudgeModel] = useState<ModelItem | null>(null)
  const [judgeThresholdInput, setJudgeThresholdInput] = useState('0.8')
  const [runsPerModel, setRunsPerModel] = useState('1')
  const [passK, setPassK] = useState('1')
  const [maxConcurrency, setMaxConcurrency] = useState('3')
  const [selectedModels, setSelectedModels] = useState<ModelConfigState[]>([])
  const [results, setResults] = useState<BattleResult[]>([])
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [currentRunId, setCurrentRunId] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [history, setHistory] = useState<BattleRunSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)

  useEffect(() => {
    if (models.length === 0) {
      fetchAll().catch(() => {})
    }
  }, [models.length, fetchAll])

  useEffect(() => {
    if (systemSettings || settingsLoading || settingsRequestedRef.current) return
    settingsRequestedRef.current = true
    fetchSystemSettings().catch(() => {
      settingsRequestedRef.current = false
    })
  }, [systemSettings, settingsLoading, fetchSystemSettings])

  const refreshHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await listBattleRuns({ page: 1, limit: 20 })
      if (res?.success && res.data) {
        setHistory(res.data.runs)
      }
    } catch (error: any) {
      toast({ title: error?.message || '加载乱斗历史失败', variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    refreshHistory()
  }, [])

  const toolAvailability = (model: ModelItem) => {
    const provider = (model.provider || '').toLowerCase()
    const providerSupportsTools = provider === 'openai' || provider === 'azure_openai'
    const isWebSearchCapable = typeof model.capabilities?.web_search === 'boolean' ? model.capabilities.web_search : true
    const isPythonCapable = typeof model.capabilities?.code_interpreter === 'boolean' ? model.capabilities.code_interpreter : true

    const canUseWebSearch =
      Boolean(systemSettings?.webSearchAgentEnable && systemSettings?.webSearchHasApiKey) &&
      providerSupportsTools &&
      isWebSearchCapable

    const canUsePython =
      Boolean(systemSettings?.pythonToolEnable) &&
      providerSupportsTools &&
      isPythonCapable

    const webSearchDisabledNote = !systemSettings?.webSearchAgentEnable
      ? '管理员未启用联网搜索'
      : !systemSettings?.webSearchHasApiKey
        ? '尚未配置搜索 API Key'
        : !providerSupportsTools
          ? '当前连接不支持工具调用'
          : !isWebSearchCapable
            ? '当前模型未开放联网搜索'
            : undefined

    const pythonDisabledNote = !systemSettings?.pythonToolEnable
      ? '管理员未开启 Python 工具'
      : !providerSupportsTools
        ? '当前连接不支持工具调用'
        : !isPythonCapable
          ? '当前模型未启用 Python 工具'
          : undefined

    return {
      canUseWebSearch,
      canUsePython,
      webSearchDisabledNote,
      pythonDisabledNote,
    }
  }

  const handleAddModel = (model: ModelItem) => {
    const key = modelKeyFor(model)
    if (selectedModels.length >= 8) {
      toast({ title: '最多只能选择 8 个参赛模型', variant: 'destructive' })
      return
    }
    if (selectedModels.some((item) => item.key === key)) {
      toast({ title: '该模型已在列表中', variant: 'destructive' })
      return
    }
    setSelectedModels((prev) => ([
      ...prev,
      {
        key,
        model,
        webSearchEnabled: false,
        pythonEnabled: false,
        customBody: '',
        customHeaders: [],
        customBodyError: null,
        advancedOpen: false,
      },
    ]))
  }

  const handleRemoveModel = (key: string) => {
    setSelectedModels((prev) => prev.filter((item) => item.key !== key))
  }

  const updateModelConfig = (key: string, updater: (item: ModelConfigState) => ModelConfigState) => {
    setSelectedModels((prev) => prev.map((item) => (item.key === key ? updater(item) : item)))
  }

  const groupedResults = useMemo(() => {
    const map = new Map<string, { key: string; label: string; attempts: BattleResult[] }>()
    for (const result of results) {
      const key = `${result.connectionId ?? 'global'}:${result.rawId ?? result.modelId}`
      const label = result.modelLabel || result.modelId
      const existing = map.get(key) || { key, label, attempts: [] }
      existing.attempts.push(result)
      map.set(key, existing)
    }
    return Array.from(map.values())
  }, [results])

  const statsMap = useMemo(() => buildModelStatsMap(summary), [summary])

  const handleRun = async () => {
    if (!prompt.trim()) {
      toast({ title: '请输入问题', variant: 'destructive' })
      return
    }
    if (!expectedAnswer.trim()) {
      toast({ title: '请输入期望答案', variant: 'destructive' })
      return
    }
    if (!judgeModel) {
      toast({ title: '请选择裁判模型', variant: 'destructive' })
      return
    }
    if (selectedModels.length === 0) {
      toast({ title: '至少选择一个参赛模型', variant: 'destructive' })
      return
    }

    const normalizedRuns = normalizeInteger(runsPerModel, 1, 1, 3)
    const normalizedPassK = normalizeInteger(passK, 1, 1, 3)
    if (normalizedPassK > normalizedRuns) {
      toast({ title: 'pass@k 不能大于运行次数', variant: 'destructive' })
      return
    }

    const modelPayloads: Array<any> = []
    let hasError = false

    const nextConfigs = selectedModels.map((item) => {
      const bodyResult = parseCustomBody(item.customBody)
      const headerResult = sanitizeHeaders(item.customHeaders)
      if (bodyResult.error) {
        hasError = true
      }
      if (!headerResult.ok) {
        hasError = true
      }
      const config = {
        ...item,
        customBodyError: bodyResult.error,
      }
      if (bodyResult.error) {
        return config
      }
      if (!headerResult.ok) {
        toast({ title: headerResult.reason || '请求头无效', variant: 'destructive' })
        return config
      }

      modelPayloads.push({
        modelId: item.model.id,
        connectionId: item.model.connectionId,
        rawId: item.model.rawId,
        features: {
          web_search: item.webSearchEnabled,
          python_tool: item.pythonEnabled,
        },
        custom_body: bodyResult.value,
        custom_headers: headerResult.headers,
      })

      return config
    })

    setSelectedModels(nextConfigs)

    if (hasError) {
      toast({ title: '请修正自定义请求配置', variant: 'destructive' })
      return
    }

    const threshold = normalizeThreshold(judgeThresholdInput, 0.8)
    const concurrency = normalizeInteger(maxConcurrency, 3, 1, 6)

    setIsRunning(true)
    setResults([])
    setSummary(null)
    setCurrentRunId(null)
    setShareLink(null)

    try {
      const payload = {
        prompt: prompt.trim(),
        expectedAnswer: expectedAnswer.trim(),
        judge: {
          modelId: judgeModel.id,
          connectionId: judgeModel.connectionId,
          rawId: judgeModel.rawId,
        },
        judgeThreshold: threshold,
        runsPerModel: normalizedRuns,
        passK: normalizedPassK,
        maxConcurrency: concurrency,
        models: modelPayloads,
      }

      for await (const event of streamBattle(payload)) {
        if (event.type === 'run_start') {
          const id = Number(event.payload?.id)
          if (Number.isFinite(id)) {
            setCurrentRunId(id)
          }
        }
        if (event.type === 'attempt_complete') {
          const result = event.payload?.result as BattleResult | undefined
          if (result) {
            const matched = models.find((m) => {
              if (result.connectionId != null && result.rawId) {
                return m.connectionId === result.connectionId && m.rawId === result.rawId
              }
              return m.id === result.modelId
            })
            const enriched = { ...result, modelLabel: result.modelLabel || matched?.name || result.modelId }
            setResults((prev) => [...prev, enriched])
          }
        }
        if (event.type === 'run_complete') {
          const nextSummary = event.payload?.summary as BattleRunSummary['summary'] | undefined
          if (nextSummary) {
            setSummary(nextSummary)
          }
        }
        if (event.type === 'error') {
          toast({ title: event.error || '乱斗执行失败', variant: 'destructive' })
          setIsRunning(false)
          return
        }
        if (event.type === 'complete') {
          setIsRunning(false)
        }
      }
    } catch (error: any) {
      toast({ title: error?.message || '乱斗执行失败', variant: 'destructive' })
    } finally {
      setIsRunning(false)
      refreshHistory()
    }
  }

  const handleLoadRun = async (runId: number) => {
    try {
      const res = await getBattleRun(runId)
      if (!res?.success || !res.data) {
        toast({ title: '加载乱斗详情失败', variant: 'destructive' })
        return
      }
      const detail = res.data as BattleRunDetail
      setCurrentRunId(detail.id)
      setPrompt(detail.prompt)
      setExpectedAnswer(detail.expectedAnswer)
      setJudgeThresholdInput(String(detail.judgeThreshold ?? 0.8))
      setRunsPerModel(String(detail.runsPerModel ?? 1))
      setPassK(String(detail.passK ?? 1))
      setSummary(detail.summary)
      setResults(detail.results || [])

      if (detail.judgeModelId) {
        const matched = models.find((m) => {
          if (detail.judgeConnectionId && detail.judgeRawId) {
            return m.connectionId === detail.judgeConnectionId && m.rawId === detail.judgeRawId
          }
          return m.id === detail.judgeModelId
        })
        setJudgeModel(matched || null)
      }
    } catch (error: any) {
      toast({ title: error?.message || '加载乱斗详情失败', variant: 'destructive' })
    }
  }

  const handleShare = async (runId: number) => {
    try {
      const res = await createBattleShare(runId)
      if (!res?.success || !res.data) {
        toast({ title: '生成分享链接失败', variant: 'destructive' })
        return
      }
      const token = res.data.token
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      const link = `${base}/share/battle/${token}`
      setShareLink(link)
      toast({ title: '分享链接已生成', description: link })
    } catch (error: any) {
      toast({ title: error?.message || '生成分享链接失败', variant: 'destructive' })
    }
  }

  const handleDeleteRun = async (runId: number) => {
    try {
      const res = await deleteBattleRun(runId)
      if (!res?.success) {
        toast({ title: res?.error || '删除失败', variant: 'destructive' })
        return
      }
      if (currentRunId === runId) {
        setCurrentRunId(null)
      }
      refreshHistory()
    } catch (error: any) {
      toast({ title: error?.message || '删除失败', variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="px-6 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">模型大乱斗</h1>
          <p className="text-sm text-muted-foreground">
            同题多模型对战，使用裁判模型评估一致性与准确率，并支持 pass@k 统计。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px,minmax(0,760px)] lg:justify-start">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">对战设置</CardTitle>
                <CardDescription>准备题目与裁判规则</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>题目</Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="输入同一题目，发送给多个模型"
                    className="min-h-[110px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>期望答案</Label>
                  <Textarea
                    value={expectedAnswer}
                    onChange={(e) => setExpectedAnswer(e.target.value)}
                    placeholder="裁判模型将使用此答案进行评估"
                    className="min-h-[110px]"
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>裁判模型</Label>
                  <ModelSelector
                    selectedModelId={judgeModel?.id || null}
                    onModelChange={setJudgeModel}
                    className="w-full justify-between"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>阈值</Label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={judgeThresholdInput}
                      onChange={(e) => setJudgeThresholdInput(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>运行次数</Label>
                    <Select value={runsPerModel} onValueChange={setRunsPerModel}>
                      <SelectTrigger>
                        <SelectValue placeholder="次数" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>pass@k</Label>
                    <Select value={passK} onValueChange={setPassK}>
                      <SelectTrigger>
                        <SelectValue placeholder="k" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>并发数</Label>
                  <Input
                    type="number"
                    min="1"
                    max="6"
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">参赛模型</CardTitle>
                <CardDescription>为每个模型配置工具与请求参数</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ModelSelector
                  selectedModelId={null}
                  onModelChange={handleAddModel}
                  className="w-full justify-between"
                />
                {selectedModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂未选择参赛模型</p>
                ) : (
                  <div className="space-y-3">
                    {selectedModels.map((item) => {
                      const availability = toolAvailability(item.model)
                      return (
                        <div key={item.key} className="rounded-xl border border-border/70 p-3 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-sm">{item.model.name}</div>
                              <div className="text-xs text-muted-foreground">{item.model.provider}</div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveModel(item.key)}
                            >
                              移除
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">联网搜索</span>
                              <Switch
                                checked={item.webSearchEnabled && availability.canUseWebSearch}
                                disabled={!availability.canUseWebSearch}
                                onCheckedChange={(checked) =>
                                  updateModelConfig(item.key, (prev) => ({
                                    ...prev,
                                    webSearchEnabled: Boolean(checked),
                                  }))
                                }
                              />
                            </div>
                            {availability.webSearchDisabledNote ? (
                              <p className="text-[11px] text-muted-foreground">{availability.webSearchDisabledNote}</p>
                            ) : null}
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Python 工具</span>
                              <Switch
                                checked={item.pythonEnabled && availability.canUsePython}
                                disabled={!availability.canUsePython}
                                onCheckedChange={(checked) =>
                                  updateModelConfig(item.key, (prev) => ({
                                    ...prev,
                                    pythonEnabled: Boolean(checked),
                                  }))
                                }
                              />
                            </div>
                            {availability.pythonDisabledNote ? (
                              <p className="text-[11px] text-muted-foreground">{availability.pythonDisabledNote}</p>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateModelConfig(item.key, (prev) => ({
                              ...prev,
                              advancedOpen: !prev.advancedOpen,
                            }))}
                          >
                            {item.advancedOpen ? '收起高级请求' : '高级请求配置'}
                          </Button>
                          {item.advancedOpen ? (
                            <CustomRequestEditor
                              customHeaders={item.customHeaders}
                              onAddHeader={() =>
                                updateModelConfig(item.key, (prev) => ({
                                  ...prev,
                                  customHeaders: [...prev.customHeaders, { name: '', value: '' }],
                                }))
                              }
                              onHeaderChange={(index, field, value) =>
                                updateModelConfig(item.key, (prev) => ({
                                  ...prev,
                                  customHeaders: prev.customHeaders.map((h, i) =>
                                    i === index ? { ...h, [field]: value } : h,
                                  ),
                                }))
                              }
                              onRemoveHeader={(index) =>
                                updateModelConfig(item.key, (prev) => ({
                                  ...prev,
                                  customHeaders: prev.customHeaders.filter((_, i) => i !== index),
                                }))
                              }
                              canAddHeader={item.customHeaders.length < 10}
                              customBody={item.customBody}
                              onCustomBodyChange={(value) =>
                                updateModelConfig(item.key, (prev) => ({
                                  ...prev,
                                  customBody: value,
                                  customBodyError: null,
                                }))
                              }
                              customBodyError={item.customBodyError}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full"
              onClick={handleRun}
              disabled={isRunning}
            >
              {isRunning ? '正在对战…' : '开始乱斗'}
            </Button>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">对战结果</CardTitle>
                    <CardDescription>裁判判定与 pass@k 统计</CardDescription>
                  </div>
                  {currentRunId ? (
                    <Button variant="outline" size="sm" onClick={() => handleShare(currentRunId)}>
                      分享结果
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {expectedAnswer.trim() ? (
                  <div className="rounded-xl border border-border/70 p-3 space-y-2">
                    <div className="text-xs text-muted-foreground">期望答案</div>
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <MarkdownRenderer html={null} fallback={expectedAnswer} />
                    </div>
                  </div>
                ) : null}
                {summary ? (
                  <div className="rounded-xl border border-border/70 p-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs text-muted-foreground">pass@k 通过模型</div>
                      <div className="text-lg font-semibold">{summary.passModelCount}/{summary.totalModels}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">一致率</div>
                      <div className="text-lg font-semibold">{(summary.accuracy * 100).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">裁判阈值</div>
                      <div className="text-lg font-semibold">
                        {(Number.isFinite(summary.judgeThreshold) ? summary.judgeThreshold : 0.8).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无统计数据</p>
                )}

                {groupedResults.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground text-center">
                    {isRunning ? '模型正在生成结果…' : '尚未生成结果'}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupedResults.map((group) => {
                      const stat = statsMap.get(group.key)
                      return (
                        <div key={group.key} className="rounded-xl border border-border/70 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-1">
                              <div className="text-sm font-medium">{group.label}</div>
                              <div className="text-xs text-muted-foreground">
                                通过 {stat?.passCount ?? 0}/{group.attempts.length}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {stat ? (
                                <Badge variant={stat.passAtK ? 'default' : 'secondary'}>
                                  {stat.passAtK ? 'pass@k' : '未通过'}
                                </Badge>
                              ) : null}
                              {stat ? (
                                <Badge variant="outline">准确率 {(stat.accuracy * 100).toFixed(0)}%</Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="space-y-4">
                            {group.attempts.map((attempt) => (
                              <div key={`${attempt.id}-${attempt.attemptIndex}`} className="rounded-lg border border-border/60 p-3 space-y-3">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>第 {attempt.attemptIndex} 次</span>
                                  <span>{attempt.durationMs != null ? `${attempt.durationMs}ms` : '--'}</span>
                                </div>
                                {attempt.error ? (
                                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    {attempt.error}
                                  </div>
                                ) : (
                                  <div className="prose prose-sm max-w-none dark:prose-invert">
                                    <MarkdownRenderer html={null} fallback={attempt.output} />
                                  </div>
                                )}
                                <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant={attempt.judgePass ? 'default' : 'secondary'}>
                                      {attempt.judgePass ? '通过' : '未通过'}
                                    </Badge>
                                    <span>score {attempt.judgeScore != null ? attempt.judgeScore.toFixed(2) : '--'}</span>
                                    {attempt.judgeFallbackUsed ? (
                                      <span className="text-muted-foreground">(阈值兜底)</span>
                                    ) : null}
                                  </div>
                                  {attempt.judgeReason ? (
                                    <div className="text-muted-foreground">{attempt.judgeReason}</div>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">历史记录</CardTitle>
                    <CardDescription>最近 20 条乱斗记录</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={refreshHistory} disabled={historyLoading}>
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[320px] pr-2">
                  {history.length === 0 ? (
                    <div className="text-sm text-muted-foreground">暂无历史记录</div>
                  ) : (
                    <div className="space-y-2">
                      {history.map((run) => (
                        <div key={run.id} className="rounded-lg border border-border/70 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium line-clamp-1">{run.title}</div>
                              <div className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</div>
                            </div>
                            <Badge variant={run.status === 'completed' ? 'default' : run.status === 'error' ? 'destructive' : 'secondary'}>
                              {run.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleLoadRun(run.id)}>
                              查看
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleShare(run.id)}>
                              分享
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDeleteRun(run.id)}>
                              删除
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {shareLink ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-3 text-sm">
            分享链接：
            <a className="text-primary hover:underline" href={shareLink} target="_blank" rel="noreferrer">
              {shareLink}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}
