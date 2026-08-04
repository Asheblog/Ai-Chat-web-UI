"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import type { SystemSettings, WebSearchBilingualMode, WebSearchEngine } from "@/types"
import { parseNumericInput } from "@/features/settings/shared"

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

export interface WebSearchCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

export function WebSearchCard({ settings, update }: WebSearchCardProps) {
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(false)
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

  useEffect(() => {
    const nextEnabledEngines = normalizeEngineList(settings.webSearchEnabledEngines, ["tavily"])
    const nextEngineOrder = normalizeEngineOrder(settings.webSearchEngineOrder, nextEnabledEngines)

    setEnabled(Boolean(settings.webSearchAgentEnable ?? false))
    setEnabledEngines(nextEnabledEngines)
    setEngineOrder(nextEngineOrder)
    setResultLimit(Number(settings.webSearchResultLimit ?? 4))
    setDomains((settings.webSearchDomainFilter ?? []).join("\n"))
    setApiKeyTavilyDraft("")
    setApiKeyBraveDraft("")
    setApiKeyMetasoDraft("")
    setApiKeyExaDraft("")
    setClearTavily(false)
    setClearBrave(false)
    setClearMetaso(false)
    setClearExa(false)
    setScope(settings.webSearchScope || "webpage")
    setIncludeSummary(Boolean(settings.webSearchIncludeSummary ?? false))
    setIncludeRaw(Boolean(settings.webSearchIncludeRaw ?? false))
    setParallelMaxEngines(Number(settings.webSearchParallelMaxEngines ?? 3))
    setParallelMaxQueries(Number(settings.webSearchParallelMaxQueriesPerCall ?? 2))
    setParallelTimeoutMs(Number(settings.webSearchParallelTimeoutMs ?? 12000))
    setAutoBilingual(Boolean(settings.webSearchAutoBilingual ?? true))
    setAutoBilingualMode(settings.webSearchAutoBilingualMode ?? "conditional")
    setAutoReadParallelism(Number(settings.webSearchAutoReadParallelism ?? 2))
  }, [settings])

  const currentEnabledEngines = useMemo(
    () => normalizeEngineList(settings.webSearchEnabledEngines, ["tavily"]),
    [settings.webSearchEnabledEngines],
  )
  const currentEngineOrder = useMemo(
    () => normalizeEngineOrder(settings.webSearchEngineOrder, currentEnabledEngines),
    [settings.webSearchEngineOrder, currentEnabledEngines],
  )

  const normalizedEngineOrder = useMemo(
    () => normalizeEngineOrder(engineOrder, enabledEngines),
    [engineOrder, enabledEngines],
  )

  const hasMetasoEnabled = enabledEngines.includes("metaso")

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

  const changed =
    enabled !== Boolean(settings.webSearchAgentEnable ?? false) ||
    !arraysEqual(enabledEngines, currentEnabledEngines) ||
    !arraysEqual(normalizedEngineOrder, currentEngineOrder) ||
    resultLimit !== Number(settings.webSearchResultLimit ?? 4) ||
    domains !== (settings.webSearchDomainFilter ?? []).join("\n") ||
    scope !== (settings.webSearchScope || "webpage") ||
    includeSummary !== Boolean(settings.webSearchIncludeSummary ?? false) ||
    includeRaw !== Boolean(settings.webSearchIncludeRaw ?? false) ||
    parallelMaxEngines !== Number(settings.webSearchParallelMaxEngines ?? 3) ||
    parallelMaxQueries !== Number(settings.webSearchParallelMaxQueriesPerCall ?? 2) ||
    parallelTimeoutMs !== Number(settings.webSearchParallelTimeoutMs ?? 12000) ||
    autoBilingual !== Boolean(settings.webSearchAutoBilingual ?? true) ||
    autoBilingualMode !== (settings.webSearchAutoBilingualMode ?? "conditional") ||
    autoReadParallelism !== Number(settings.webSearchAutoReadParallelism ?? 2) ||
    apiKeyTavilyDraft.trim() !== "" ||
    apiKeyBraveDraft.trim() !== "" ||
    apiKeyMetasoDraft.trim() !== "" ||
    apiKeyExaDraft.trim() !== "" ||
    clearTavily ||
    clearBrave ||
    clearMetaso ||
    clearExa

  const valid =
    enabledEngines.length > 0 &&
    limitValid &&
    parallelMaxEnginesValid &&
    parallelMaxQueriesValid &&
    parallelTimeoutValid &&
    autoReadParallelismValid

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
    if (!valid) return

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

    await update(payload)
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

  return (
    <FeatureCard
      icon={Globe}
      title="联网搜索"
      description="在回答前自动检索网页，支持多引擎并行"
      cardKey="search-knowledge:web-search"
      enabled={enabled}
      onEnabledChange={setEnabled}
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
          <Button onClick={save} disabled={!changed || !valid}>
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
                ? settings.webSearchHasApiKeyTavily
                : engine.value === "brave"
                  ? settings.webSearchHasApiKeyBrave
                  : engine.value === "metaso"
                    ? settings.webSearchHasApiKeyMetaso
                    : settings.webSearchHasApiKeyExa
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
              {settings.webSearchHasApiKeyTavily && !clearTavily ? "已配置" : "未配置"}
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
              disabled={!settings.webSearchHasApiKeyTavily && !clearTavily}
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
              {settings.webSearchHasApiKeyBrave && !clearBrave ? "已配置" : "未配置"}
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
              disabled={!settings.webSearchHasApiKeyBrave && !clearBrave}
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
              {settings.webSearchHasApiKeyMetaso && !clearMetaso ? "已配置" : "未配置"}
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
              disabled={!settings.webSearchHasApiKeyMetaso && !clearMetaso}
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
              {settings.webSearchHasApiKeyExa && !clearExa ? "已配置" : "未配置"}
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
              disabled={!settings.webSearchHasApiKeyExa && !clearExa}
            >
              清除
            </Button>
          </div>
          {clearExa && <p className="text-xs text-destructive">保存后将删除 Exa Key。</p>}
        </div>
      </div>
    </FeatureCard>
  )
}
