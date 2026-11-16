"use client"

import { useEffect, useMemo, useState } from "react"
import { Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SettingRow } from "@/components/settings/components/setting-row"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { parseNumericInput } from "@/features/settings/shared"
import type { SystemSettings, WebSearchBilingualMode, WebSearchEngine } from "@/types"
import type { WebSearchScope } from "@aichat/shared"
import { ApiKeyFields } from "./web-search/api-key-fields"
import { EngineSelection } from "./web-search/engine-selection"
import {
  SearchExecutionParams,
  type SearchExecutionValues,
} from "./web-search/search-execution-params"
import {
  BILINGUAL_MODE_OPTIONS,
  RAW_CONTENT_ENGINES,
  SCOPE_OPTIONS,
  SUMMARY_ENGINES,
  WEB_SEARCH_RANGES,
  arraysEqual,
  clampToRange,
  hasAnyEngine,
  normalizeDomains,
  normalizeEngineList,
} from "./web-search/web-search-constants"

export interface WebSearchCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

const EMPTY_KEY_DRAFTS: Record<WebSearchEngine, string> = {
  tavily: "",
  brave: "",
  metaso: "",
  exa: "",
  deepseek: "",
}
const EMPTY_KEY_CLEARS: Record<WebSearchEngine, boolean> = {
  tavily: false,
  brave: false,
  metaso: false,
  exa: false,
  deepseek: false,
}

const readEnabled = (settings: SystemSettings) => Boolean(settings.webSearchAgentEnable ?? false)
const readEngines = (settings: SystemSettings) =>
  normalizeEngineList(settings.webSearchEnabledEngines, ["tavily"])
const readBilingualMode = (settings: SystemSettings): WebSearchBilingualMode =>
  settings.webSearchAutoBilingualMode ?? "conditional"
const readScope = (settings: SystemSettings): WebSearchScope =>
  (settings.webSearchScope || "webpage") as WebSearchScope

const readExecution = (settings: SystemSettings): SearchExecutionValues => ({
  parallelMaxEngines: Number(settings.webSearchParallelMaxEngines ?? 3),
  parallelMaxQueriesPerCall: Number(settings.webSearchParallelMaxQueriesPerCall ?? 2),
  parallelTimeoutMs: Number(settings.webSearchParallelTimeoutMs ?? 12000),
  autoReadParallelism: Number(settings.webSearchAutoReadParallelism ?? 2),
  autoReadBatchTimeoutMs: Number(
    settings.webSearchAutoReadBatchTimeoutMs ?? WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.fallback,
  ),
})

const readEngineKeyFlags = (settings: SystemSettings): Record<WebSearchEngine, boolean> => ({
  tavily: Boolean(settings.webSearchHasApiKeyTavily),
  brave: Boolean(settings.webSearchHasApiKeyBrave),
  metaso: Boolean(settings.webSearchHasApiKeyMetaso),
  exa: Boolean(settings.webSearchHasApiKeyExa),
  deepseek: Boolean(settings.webSearchHasApiKeyDeepseek),
})

/**
 * 联网搜索卡：有序启用引擎 + 检索范围/召回 + 凭据 + 执行参数。
 *
 * 状态真源只有一份——`webSearchEnabledEngines` 的数组顺序既是启用集合也是优先级，
 * 独立的引擎顺序键已删除；双语也只有 `autoBilingualMode` 三态，不再有布尔开关。
 */
export function WebSearchCard({ settings, update }: WebSearchCardProps) {
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(false)
  const [engines, setEngines] = useState<WebSearchEngine[]>(() => readEngines(settings))
  const [resultLimit, setResultLimit] = useState(4)
  const [domains, setDomains] = useState("")
  const [scope, setScope] = useState<WebSearchScope>("webpage")
  const [includeSummary, setIncludeSummary] = useState(false)
  const [includeRaw, setIncludeRaw] = useState(false)
  const [bilingualMode, setBilingualMode] = useState<WebSearchBilingualMode>("conditional")
  const [deepseekFetchEnable, setDeepseekFetchEnable] = useState(false)
  const [execution, setExecution] = useState<SearchExecutionValues>(() => readExecution(settings))
  const [keyDrafts, setKeyDrafts] = useState({ ...EMPTY_KEY_DRAFTS })
  const [keyClears, setKeyClears] = useState({ ...EMPTY_KEY_CLEARS })
  const [saving, setSaving] = useState(false)

  const savedEngineKeyFlags = useMemo(() => readEngineKeyFlags(settings), [settings])

  useEffect(() => {
    setEnabled(readEnabled(settings))
    setEngines(readEngines(settings))
    setResultLimit(Number(settings.webSearchResultLimit ?? 4))
    setDomains((settings.webSearchDomainFilter ?? []).join("\n"))
    setScope(readScope(settings))
    setIncludeSummary(Boolean(settings.webSearchIncludeSummary ?? false))
    setIncludeRaw(Boolean(settings.webSearchIncludeRaw ?? false))
    setBilingualMode(readBilingualMode(settings))
    setDeepseekFetchEnable(Boolean(settings.webSearchDeepseekFetchEnable ?? false))
    setExecution(readExecution(settings))
    setKeyDrafts({ ...EMPTY_KEY_DRAFTS })
    setKeyClears({ ...EMPTY_KEY_CLEARS })
  }, [settings])

  // 已保存的 Key 或本次草稿都算"可用"，清除标记优先
  const engineHasKey = (engine: WebSearchEngine) =>
    !keyClears[engine] && (savedEngineKeyFlags[engine] || keyDrafts[engine].trim() !== "")

  const savedEngines = readEngines(settings)
  const savedExecution = readExecution(settings)
  const savedBilingualMode = readBilingualMode(settings)

  const limitValid =
    resultLimit >= WEB_SEARCH_RANGES.resultLimit.min && resultLimit <= WEB_SEARCH_RANGES.resultLimit.max

  const executionInvalid: Partial<Record<keyof SearchExecutionValues, boolean>> = {
    parallelMaxEngines:
      execution.parallelMaxEngines < WEB_SEARCH_RANGES.parallelMaxEngines.min ||
      execution.parallelMaxEngines > WEB_SEARCH_RANGES.parallelMaxEngines.max,
    parallelMaxQueriesPerCall:
      execution.parallelMaxQueriesPerCall < WEB_SEARCH_RANGES.parallelMaxQueriesPerCall.min ||
      execution.parallelMaxQueriesPerCall > WEB_SEARCH_RANGES.parallelMaxQueriesPerCall.max,
    parallelTimeoutMs:
      execution.parallelTimeoutMs < WEB_SEARCH_RANGES.parallelTimeoutMs.min ||
      execution.parallelTimeoutMs > WEB_SEARCH_RANGES.parallelTimeoutMs.max,
    autoReadParallelism:
      execution.autoReadParallelism < WEB_SEARCH_RANGES.autoReadParallelism.min ||
      execution.autoReadParallelism > WEB_SEARCH_RANGES.autoReadParallelism.max,
    autoReadBatchTimeoutMs:
      execution.autoReadBatchTimeoutMs < WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.min ||
      execution.autoReadBatchTimeoutMs > WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.max,
  }
  const executionValid = Object.values(executionInvalid).every((invalid) => !invalid)
  const bilingualBlocked = bilingualMode !== "off" && execution.parallelMaxQueriesPerCall <= 1

  const keyDraftChanged =
    keyDrafts.tavily.trim() !== "" ||
    keyDrafts.brave.trim() !== "" ||
    keyDrafts.metaso.trim() !== "" ||
    keyDrafts.exa.trim() !== "" ||
    keyDrafts.deepseek.trim() !== ""
  const keyClearPending = Object.values(keyClears).some(Boolean)

  const changed =
    enabled !== readEnabled(settings) ||
    !arraysEqual(engines, savedEngines) ||
    resultLimit !== Number(settings.webSearchResultLimit ?? 4) ||
    domains !== (settings.webSearchDomainFilter ?? []).join("\n") ||
    scope !== readScope(settings) ||
    includeSummary !== Boolean(settings.webSearchIncludeSummary ?? false) ||
    includeRaw !== Boolean(settings.webSearchIncludeRaw ?? false) ||
    bilingualMode !== savedBilingualMode ||
    deepseekFetchEnable !== Boolean(settings.webSearchDeepseekFetchEnable ?? false) ||
    execution.parallelMaxEngines !== savedExecution.parallelMaxEngines ||
    execution.parallelMaxQueriesPerCall !== savedExecution.parallelMaxQueriesPerCall ||
    execution.parallelTimeoutMs !== savedExecution.parallelTimeoutMs ||
    execution.autoReadParallelism !== savedExecution.autoReadParallelism ||
    execution.autoReadBatchTimeoutMs !== savedExecution.autoReadBatchTimeoutMs ||
    keyDraftChanged ||
    keyClearPending

  const valid = engines.length > 0 && limitValid && executionValid

  const toggleEngine = (engine: WebSearchEngine, nextEnabled: boolean) => {
    setEngines((prev) => {
      if (nextEnabled) {
        return prev.includes(engine) ? prev : [...prev, engine]
      }
      return prev.filter((item) => item !== engine)
    })
  }

  const moveEngine = (engine: WebSearchEngine, direction: "up" | "down") => {
    setEngines((prev) => {
      const index = prev.indexOf(engine)
      if (index < 0) return prev
      const target = direction === "up" ? index - 1 : index + 1
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const updateExecution = (key: keyof SearchExecutionValues, value: number) => {
    setExecution((prev) => ({ ...prev, [key]: value }))
  }

  const save = async () => {
    if (!valid || saving) return

    const payload: Partial<SystemSettings> = {
      webSearchAgentEnable: enabled,
      // 有序启用引擎列表：顺序即优先级，不再单独提交 engineOrder
      webSearchEnabledEngines: engines,
      webSearchResultLimit: clampToRange(resultLimit, WEB_SEARCH_RANGES.resultLimit),
      webSearchDomainFilter: normalizeDomains(domains),
      webSearchScope: scope,
      webSearchIncludeSummary: includeSummary,
      webSearchIncludeRaw: includeRaw,
      webSearchDeepseekFetchEnable: deepseekFetchEnable,
      webSearchAutoBilingualMode: bilingualMode,
      webSearchParallelMaxEngines: clampToRange(
        Math.min(execution.parallelMaxEngines, engines.length),
        WEB_SEARCH_RANGES.parallelMaxEngines,
      ),
      webSearchParallelMaxQueriesPerCall: clampToRange(
        execution.parallelMaxQueriesPerCall,
        WEB_SEARCH_RANGES.parallelMaxQueriesPerCall,
      ),
      webSearchParallelTimeoutMs: clampToRange(
        execution.parallelTimeoutMs,
        WEB_SEARCH_RANGES.parallelTimeoutMs,
      ),
      webSearchAutoReadParallelism: clampToRange(
        execution.autoReadParallelism,
        WEB_SEARCH_RANGES.autoReadParallelism,
      ),
      webSearchAutoReadBatchTimeoutMs: clampToRange(
        execution.autoReadBatchTimeoutMs,
        WEB_SEARCH_RANGES.autoReadBatchTimeoutMs,
      ),
    }

    if (keyDrafts.tavily.trim()) payload.webSearchApiKeyTavily = keyDrafts.tavily.trim()
    else if (keyClears.tavily) payload.webSearchApiKeyTavily = ""
    if (keyDrafts.brave.trim()) payload.webSearchApiKeyBrave = keyDrafts.brave.trim()
    else if (keyClears.brave) payload.webSearchApiKeyBrave = ""
    if (keyDrafts.metaso.trim()) payload.webSearchApiKeyMetaso = keyDrafts.metaso.trim()
    else if (keyClears.metaso) payload.webSearchApiKeyMetaso = ""
    if (keyDrafts.exa.trim()) payload.webSearchApiKeyExa = keyDrafts.exa.trim()
    else if (keyClears.exa) payload.webSearchApiKeyExa = ""
    if (keyDrafts.deepseek.trim()) payload.webSearchApiKeyDeepseek = keyDrafts.deepseek.trim()
    else if (keyClears.deepseek) payload.webSearchApiKeyDeepseek = ""

    setSaving(true)
    try {
      await update(payload)
      setKeyDrafts({ ...EMPTY_KEY_DRAFTS })
      setKeyClears({ ...EMPTY_KEY_CLEARS })
      toast({ title: "联网搜索设置已保存" })
    } catch (error) {
      // 保存失败时保留当前输入，只提示失败原因
      toast({
        title: "联网搜索设置保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const showSummaryToggle = hasAnyEngine(engines, SUMMARY_ENGINES)
  const showRawToggle = hasAnyEngine(engines, RAW_CONTENT_ENGINES)

  return (
    <FeatureCard
      icon={Globe}
      title="联网搜索"
      description="在回答前自动检索网页，多引擎并行并按列表顺序优先调度"
      cardKey="search-knowledge:web-search"
      enabled={enabled}
      onEnabledChange={setEnabled}
      more={
        <SearchExecutionParams
          values={execution}
          invalid={executionInvalid}
          bilingualBlocked={bilingualBlocked}
          onChange={(key, value) => updateExecution(key, value)}
        />
      }
      footer={
        <div className="flex justify-end">
          <Button onClick={save} disabled={!changed || !valid || saving}>
            {saving ? "保存中..." : "保存联网搜索设置"}
          </Button>
        </div>
      }
    >
      <EngineSelection
        engines={engines}
        hasKey={engineHasKey}
        onToggle={toggleEngine}
        onMove={moveEngine}
      />

      <SettingRow
        title="每次融合结果数"
        description={`合并多个引擎后返回的结果条数（${WEB_SEARCH_RANGES.resultLimit.min}-${WEB_SEARCH_RANGES.resultLimit.max}）。`}
        htmlFor="web-search-result-limit"
      >
        <Input
          id="web-search-result-limit"
          type="text"
          inputMode="numeric"
          value={resultLimit}
          onChange={(event) => setResultLimit((prev) => parseNumericInput(event.target.value, prev))}
          className={limitValid ? undefined : "border-destructive"}
        />
      </SettingRow>

      <SettingRow
        title="默认搜索范围"
        description="检索时默认使用的范围；对支持该参数的引擎生效，图片范围会跳过自动阅读。"
        htmlFor="web-search-scope"
      >
        <Select value={scope} onValueChange={(value) => setScope(value as WebSearchScope)}>
          <SelectTrigger id="web-search-scope">
            <SelectValue placeholder="选择搜索范围" />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      {showSummaryToggle ? (
        <SettingRow
          title="召回增强"
          description="Metaso / Exa 用摘要参与召回排序，可能略增延迟。"
        >
          {(descriptionId) => (
            <Switch
              aria-label="召回增强"
              aria-describedby={descriptionId}
              checked={includeSummary}
              onCheckedChange={(value) => setIncludeSummary(Boolean(value))}
            />
          )}
        </SettingRow>
      ) : null}

      {showRawToggle ? (
        <SettingRow
          title="获取网页原文"
          description="搜索时同时取回可用的网页正文（Tavily / Exa / Metaso / DeepSeek）；自动阅读需要正文时会强制取正文。"
        >
          {(descriptionId) => (
            <Switch
              aria-label="获取网页原文"
              aria-describedby={descriptionId}
              checked={includeRaw}
              onCheckedChange={(value) => setIncludeRaw(Boolean(value))}
            />
          )}
        </SettingRow>
      ) : null}

      <SettingRow
        title="自动双语检索"
        description={
          BILINGUAL_MODE_OPTIONS.find((option) => option.value === bilingualMode)?.hint ??
          "提示中涉及跨语种信息时是否补充另一种语言的查询。"
        }
        htmlFor="web-search-bilingual-mode"
      >
        <Select
          value={bilingualMode}
          onValueChange={(value) => setBilingualMode(value as WebSearchBilingualMode)}
        >
          <SelectTrigger id="web-search-bilingual-mode">
            <SelectValue placeholder="选择策略" />
          </SelectTrigger>
          <SelectContent>
            {BILINGUAL_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold leading-6 text-foreground">域名白名单</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
            每行一个域名，留空表示不过滤；能下推给引擎的会走引擎原生参数。
          </p>
        </div>
        <Textarea
          id="web-search-domains"
          aria-label="域名白名单"
          rows={4}
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          placeholder={"example.com\nanother-site.org"}
        />
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold leading-6 text-foreground">搜索引擎凭据</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
            凭据只写不读；留空保存表示不修改，需要删除时点「清除」。
          </p>
        </div>
        <ApiKeyFields
          drafts={keyDrafts}
          clears={keyClears}
          hasKey={engineHasKey}
          onDraftChange={(engine, value) => {
            setKeyDrafts((prev) => ({ ...prev, [engine]: value }))
            if (value) setKeyClears((prev) => ({ ...prev, [engine]: false }))
          }}
          onClear={(engine) => {
            setKeyDrafts((prev) => ({ ...prev, [engine]: "" }))
            setKeyClears((prev) => ({ ...prev, [engine]: true }))
          }}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-semibold leading-6 text-foreground">网页读取：DeepSeek Fetch 付费回退</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
            属于读页链路而非搜索：不依赖上方引擎勾选，仅在本地读页失败时回退，调用会产生 DeepSeek API 费用，默认关闭。
          </p>
        </div>
        <SettingRow
          title="启用 DeepSeek Fetch 付费回退"
          description="DeepSeek 支持网页搜索，不支持图片检索；搜索与 Fetch 调用都会产生 API 费用。"
        >
          {(descriptionId) => (
            <Switch
              aria-label="启用 DeepSeek Fetch 付费回退"
              aria-describedby={descriptionId}
              checked={deepseekFetchEnable}
              onCheckedChange={(value) => setDeepseekFetchEnable(Boolean(value))}
            />
          )}
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
