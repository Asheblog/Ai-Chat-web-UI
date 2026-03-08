"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useSystemSettings } from "@/hooks/use-system-settings"
import type { WebSearchBilingualMode, WebSearchEngine } from "@/types"

const ENGINE_OPTIONS: Array<{ value: WebSearchEngine; label: string }> = [
  { value: "tavily", label: "Tavily" },
  { value: "brave", label: "Brave" },
  { value: "metaso", label: "Metaso（秘塔）" },
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
            item === "tavily" || item === "brave" || item === "metaso",
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

const parseNumericInput = (value: string, fallback: number) => {
  const trimmed = value.trim()
  if (trimmed === "") return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function SystemWebSearchPage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(false)
  const [enabledEngines, setEnabledEngines] = useState<WebSearchEngine[]>(["tavily"])
  const [engineOrder, setEngineOrder] = useState<WebSearchEngine[]>(["tavily"])
  const [resultLimit, setResultLimit] = useState(4)
  const [domains, setDomains] = useState("")
  const [apiKeyTavilyDraft, setApiKeyTavilyDraft] = useState("")
  const [apiKeyBraveDraft, setApiKeyBraveDraft] = useState("")
  const [apiKeyMetasoDraft, setApiKeyMetasoDraft] = useState("")
  const [clearTavily, setClearTavily] = useState(false)
  const [clearBrave, setClearBrave] = useState(false)
  const [clearMetaso, setClearMetaso] = useState(false)
  const [scope, setScope] = useState("webpage")
  const [includeSummary, setIncludeSummary] = useState(false)
  const [includeRaw, setIncludeRaw] = useState(false)
  const [parallelMaxEngines, setParallelMaxEngines] = useState(3)
  const [parallelMaxQueries, setParallelMaxQueries] = useState(2)
  const [parallelTimeoutMs, setParallelTimeoutMs] = useState(12000)
  const [autoBilingual, setAutoBilingual] = useState(true)
  const [autoBilingualMode, setAutoBilingualMode] = useState<WebSearchBilingualMode>("conditional")
  const [autoReadParallelism, setAutoReadParallelism] = useState(2)
  const [pythonEnabled, setPythonEnabled] = useState(false)
  const [chatDynamicSkillRuntimeEnabled, setChatDynamicSkillRuntimeEnabled] = useState(false)
  const [pythonTimeout, setPythonTimeout] = useState(8000)
  const [pythonMaxOutput, setPythonMaxOutput] = useState(4000)
  const [pythonMaxSource, setPythonMaxSource] = useState(4000)
  const [maxToolIterations, setMaxToolIterations] = useState(4)

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  useEffect(() => {
    if (!systemSettings) return
    const nextEnabledEngines = normalizeEngineList(systemSettings.webSearchEnabledEngines, ["tavily"])
    const nextEngineOrder = normalizeEngineOrder(systemSettings.webSearchEngineOrder, nextEnabledEngines)

    setEnabled(Boolean(systemSettings.webSearchAgentEnable ?? false))
    setEnabledEngines(nextEnabledEngines)
    setEngineOrder(nextEngineOrder)
    setResultLimit(Number(systemSettings.webSearchResultLimit ?? 4))
    setDomains((systemSettings.webSearchDomainFilter ?? []).join("\n"))
    setApiKeyTavilyDraft("")
    setApiKeyBraveDraft("")
    setApiKeyMetasoDraft("")
    setClearTavily(false)
    setClearBrave(false)
    setClearMetaso(false)
    setScope(systemSettings.webSearchScope || "webpage")
    setIncludeSummary(Boolean(systemSettings.webSearchIncludeSummary ?? false))
    setIncludeRaw(Boolean(systemSettings.webSearchIncludeRaw ?? false))
    setParallelMaxEngines(Number(systemSettings.webSearchParallelMaxEngines ?? 3))
    setParallelMaxQueries(Number(systemSettings.webSearchParallelMaxQueriesPerCall ?? 2))
    setParallelTimeoutMs(Number(systemSettings.webSearchParallelTimeoutMs ?? 12000))
    setAutoBilingual(Boolean(systemSettings.webSearchAutoBilingual ?? true))
    setAutoBilingualMode(systemSettings.webSearchAutoBilingualMode ?? "conditional")
    setAutoReadParallelism(Number(systemSettings.webSearchAutoReadParallelism ?? 2))
    setPythonEnabled(Boolean(systemSettings.pythonToolEnable ?? false))
    setChatDynamicSkillRuntimeEnabled(Boolean(systemSettings.chatDynamicSkillRuntimeEnabled ?? false))
    setPythonTimeout(Number(systemSettings.pythonToolTimeoutMs ?? 8000))
    setPythonMaxOutput(Number(systemSettings.pythonToolMaxOutputChars ?? 4000))
    setPythonMaxSource(Number(systemSettings.pythonToolMaxSourceChars ?? 4000))
    setMaxToolIterations(Number(systemSettings.agentMaxToolIterations ?? 4))
  }, [systemSettings])

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

  const limitRange = { min: 1, max: 10 }
  const parallelEngineRange = { min: 1, max: 3 }
  const parallelQueryRange = { min: 1, max: 3 }
  const parallelTimeoutRange = { min: 1000, max: 120000 }
  const autoReadParallelismRange = { min: 1, max: 4 }
  const pythonTimeoutRange = { min: 1000, max: 60000 }
  const pythonOutputRange = { min: 256, max: 20000 }
  const agentIterationRange = { min: 0, max: 20 }

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
  const pythonTimeoutValid =
    pythonTimeout >= pythonTimeoutRange.min && pythonTimeout <= pythonTimeoutRange.max
  const pythonMaxOutputValid =
    pythonMaxOutput >= pythonOutputRange.min && pythonMaxOutput <= pythonOutputRange.max
  const pythonMaxSourceValid =
    pythonMaxSource >= pythonOutputRange.min && pythonMaxSource <= pythonOutputRange.max
  const agentIterationValid =
    maxToolIterations >= agentIterationRange.min && maxToolIterations <= agentIterationRange.max
  const defaultToolIterations = Number(systemSettings.agentMaxToolIterations ?? 4)

  const changed =
    enabled !== Boolean(systemSettings.webSearchAgentEnable ?? false) ||
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
    pythonEnabled !== Boolean(systemSettings.pythonToolEnable ?? false) ||
    chatDynamicSkillRuntimeEnabled !==
      Boolean(systemSettings.chatDynamicSkillRuntimeEnabled ?? false) ||
    pythonTimeout !== Number(systemSettings.pythonToolTimeoutMs ?? 8000) ||
    pythonMaxOutput !== Number(systemSettings.pythonToolMaxOutputChars ?? 4000) ||
    pythonMaxSource !== Number(systemSettings.pythonToolMaxSourceChars ?? 4000) ||
    maxToolIterations !== Number(systemSettings.agentMaxToolIterations ?? 4) ||
    apiKeyTavilyDraft.trim() !== "" ||
    apiKeyBraveDraft.trim() !== "" ||
    apiKeyMetasoDraft.trim() !== "" ||
    clearTavily ||
    clearBrave ||
    clearMetaso

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

  const save = async () => {
    if (
      enabledEngines.length === 0 ||
      !limitValid ||
      !parallelMaxEnginesValid ||
      !parallelMaxQueriesValid ||
      !parallelTimeoutValid ||
      !autoReadParallelismValid ||
      !pythonTimeoutValid ||
      !pythonMaxOutputValid ||
      !pythonMaxSourceValid ||
      !agentIterationValid
    ) {
      return
    }

    const payload: Record<string, any> = {
      webSearchAgentEnable: enabled,
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
      pythonToolEnable: pythonEnabled,
      chatDynamicSkillRuntimeEnabled,
      pythonToolTimeoutMs: Math.max(
        pythonTimeoutRange.min,
        Math.min(pythonTimeoutRange.max, Math.round(pythonTimeout)),
      ),
      pythonToolMaxOutputChars: Math.max(
        pythonOutputRange.min,
        Math.min(pythonOutputRange.max, Math.round(pythonMaxOutput)),
      ),
      pythonToolMaxSourceChars: Math.max(
        pythonOutputRange.min,
        Math.min(pythonOutputRange.max, Math.round(pythonMaxSource)),
      ),
      agentMaxToolIterations: Math.max(
        agentIterationRange.min,
        Math.min(agentIterationRange.max, Math.round(maxToolIterations)),
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

    await updateSystemSettings(payload)
    setApiKeyTavilyDraft("")
    setApiKeyBraveDraft("")
    setApiKeyMetasoDraft("")
    setClearTavily(false)
    setClearBrave(false)
    setClearMetaso(false)
    toast({ title: "联网搜索设置已保存" })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <Globe className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">联网搜索（Agent）</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            可配置多引擎并行检索，并在需要时自动扩展中英文查询。
          </CardDescription>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">启用联网搜索</p>
          <p className="text-xs text-muted-foreground">
            当前模型默认开关：{enabled ? "已启用" : "已关闭"}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} />
      </div>

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
                  : systemSettings.webSearchHasApiKeyMetaso
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

      <div className="grid gap-4 md:grid-cols-2">
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

      <div className="grid gap-4 md:grid-cols-3">
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
      </div>

      <div className="pt-5 border-t border-border/60 space-y-4">
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">
            Python 工具（本地计算）
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            允许模型调用 python_runner 进行数值或结构化计算。运行在后端容器内，请确认镜像已安装 Python。
          </CardDescription>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">启用 Python 工具</p>
            <p className="text-xs text-muted-foreground">
              仅 OpenAI / Azure OpenAI 等支持工具调用的连接可用。
            </p>
          </div>
          <Switch checked={pythonEnabled} onCheckedChange={(v) => setPythonEnabled(!!v)} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50/50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-950/30">
          <div>
            <p className="text-sm font-medium">启用聊天侧第三方动态 Skill Runtime</p>
            <p className="text-xs text-muted-foreground">
              默认关闭。开启后，聊天可直接调度已安装并绑定的第三方 Skill；建议配合审批与审计策略。
            </p>
          </div>
          <Switch
            checked={chatDynamicSkillRuntimeEnabled}
            onCheckedChange={(v) => setChatDynamicSkillRuntimeEnabled(!!v)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Python 解释器由受管运行环境统一提供（`/app/data/python-runtime/venv`），不再支持在此处自定义命令参数。
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">超时时间（毫秒）</label>
            <Input
              type="text"
              value={pythonTimeout}
              onChange={(e) => setPythonTimeout((prev) => parseNumericInput(e.target.value, prev))}
              className={!pythonTimeoutValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {pythonTimeoutRange.min} - {pythonTimeoutRange.max}，默认 8000。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">stdout 截断字符数</label>
            <Input
              type="text"
              value={pythonMaxOutput}
              onChange={(e) => setPythonMaxOutput((prev) => parseNumericInput(e.target.value, prev))}
              className={!pythonMaxOutputValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {pythonOutputRange.min} - {pythonOutputRange.max}，默认 4000。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">代码长度限制</label>
            <Input
              type="text"
              value={pythonMaxSource}
              onChange={(e) => setPythonMaxSource((prev) => parseNumericInput(e.target.value, prev))}
              className={!pythonMaxSourceValid ? "border-destructive" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {pythonOutputRange.min} - {pythonOutputRange.max}，默认 4000。
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Agent 工具最大迭代次数（0 表示无限制）</label>
          <Input
            type="text"
            value={maxToolIterations}
            onChange={(e) => setMaxToolIterations((prev) => parseNumericInput(e.target.value, prev))}
            className={!agentIterationValid ? "border-destructive" : undefined}
          />
          <p className="text-xs text-muted-foreground">
            当前默认值：{defaultToolIterations}；范围 {agentIterationRange.min}-{agentIterationRange.max}，0 表示允许模型无限次调用工具。
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          onClick={save}
          disabled={
            !changed ||
            enabledEngines.length === 0 ||
            !limitValid ||
            !parallelMaxEnginesValid ||
            !parallelMaxQueriesValid ||
            !parallelTimeoutValid ||
            !autoReadParallelismValid ||
            !pythonTimeoutValid ||
            !pythonMaxOutputValid ||
            !pythonMaxSourceValid ||
            !agentIterationValid
          }
        >
          保存联网搜索设置
        </Button>
      </div>
    </div>
  )
}
