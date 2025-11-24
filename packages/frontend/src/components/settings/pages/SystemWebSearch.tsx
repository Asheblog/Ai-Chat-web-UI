"use client"

import { useEffect, useState } from "react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { Globe } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  const [engine, setEngine] = useState("tavily")
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

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  useEffect(() => {
    if (!systemSettings) return
    setEnabled(Boolean(systemSettings.webSearchAgentEnable ?? false))
    setEngine(systemSettings.webSearchDefaultEngine || "tavily")
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

  const normalizeDomains = (text: string) =>
    text
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)

  const limitRange = { min: 1, max: 10 }
  const limitValid = resultLimit >= limitRange.min && resultLimit <= limitRange.max

  const changed =
    enabled !== Boolean(systemSettings.webSearchAgentEnable ?? false) ||
    engine !== (systemSettings.webSearchDefaultEngine || "tavily") ||
    resultLimit !== Number(systemSettings.webSearchResultLimit ?? 4) ||
    domains !== (systemSettings.webSearchDomainFilter ?? []).join("\n") ||
    scope !== (systemSettings.webSearchScope || "webpage") ||
    includeSummary !== Boolean(systemSettings.webSearchIncludeSummary ?? false) ||
    includeRaw !== Boolean(systemSettings.webSearchIncludeRaw ?? false) ||
    apiKeyTavilyDraft.trim() !== "" ||
    apiKeyBraveDraft.trim() !== "" ||
    apiKeyMetasoDraft.trim() !== "" ||
    clearTavily ||
    clearBrave ||
    clearMetaso

  const save = async () => {
    if (!limitValid) return
    const payload: Record<string, any> = {
      webSearchAgentEnable: enabled,
      webSearchDefaultEngine: engine.trim() || "tavily",
      webSearchResultLimit: Math.max(
        limitRange.min,
        Math.min(limitRange.max, Math.round(resultLimit)),
      ),
      webSearchDomainFilter: normalizeDomains(domains),
      webSearchScope: scope,
      webSearchIncludeSummary: includeSummary,
      webSearchIncludeRaw: includeRaw,
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
            当模型具备工具调用能力时，可实时检索网页并返回最新信息。
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
        <Switch checked={enabled} onCheckedChange={(v)=>setEnabled(!!v)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="web-search-engine">
            默认搜索引擎
          </label>
          <Select value={engine} onValueChange={(value)=>setEngine(value)}>
            <SelectTrigger id="web-search-engine">
              <SelectValue placeholder="请选择搜索引擎" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tavily">Tavily</SelectItem>
              <SelectItem value="brave">Brave</SelectItem>
              <SelectItem value="metaso">Metaso（秘塔）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="web-search-limit">
            每次检索结果数（1-10）
          </label>
          <Input
            id="web-search-limit"
            type="number"
            value={resultLimit}
            onChange={(e)=>setResultLimit(Number(e.target.value || 0))}
            className={!limitValid ? "border-destructive" : undefined}
          />
        </div>
      </div>

      {engine === "metaso" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="web-search-scope">
              默认搜索范围（仅 Metaso）
            </label>
            <Select value={scope} onValueChange={(value)=>setScope(value)}>
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
                <p className="text-xs text-muted-foreground">适度提升结果召回，可能略增延迟</p>
              </div>
              <Switch checked={includeSummary} onCheckedChange={(v)=>setIncludeSummary(!!v)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">抓取原文（includeRawContent）</p>
                <p className="text-xs text-muted-foreground">可能增加流量与时延，默认关闭</p>
              </div>
              <Switch checked={includeRaw} onCheckedChange={(v)=>setIncludeRaw(!!v)} />
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
          onChange={(e)=>setDomains(e.target.value)}
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
              onChange={(e)=>{
                setApiKeyTavilyDraft(e.target.value)
                if (clearTavily) setClearTavily(false)
              }}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={()=>{
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
              onChange={(e)=>{
                setApiKeyBraveDraft(e.target.value)
                if (clearBrave) setClearBrave(false)
              }}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={()=>{
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
              onChange={(e)=>{
                setApiKeyMetasoDraft(e.target.value)
                if (clearMetaso) setClearMetaso(false)
              }}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={()=>{
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

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={!changed || !limitValid || engine.trim() === ""}>
          保存联网搜索设置
        </Button>
      </div>
    </div>
  )
}
