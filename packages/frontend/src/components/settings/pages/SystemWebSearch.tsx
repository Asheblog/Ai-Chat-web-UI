"use client"

import { useEffect, useState } from "react"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettingsStore } from "@/store/settings-store"
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
  const { systemSettings, fetchSystemSettings, updateSystemSettings, isLoading, error } = useSettingsStore()
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [engine, setEngine] = useState("tavily")
  const [resultLimit, setResultLimit] = useState(4)
  const [domains, setDomains] = useState("")
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [clearStoredKey, setClearStoredKey] = useState(false)

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  useEffect(() => {
    if (!systemSettings) return
    setEnabled(Boolean(systemSettings.webSearchAgentEnable ?? false))
    setEngine(systemSettings.webSearchDefaultEngine || "tavily")
    setResultLimit(Number(systemSettings.webSearchResultLimit ?? 4))
    setDomains((systemSettings.webSearchDomainFilter ?? []).join("\n"))
    setApiKeyDraft("")
    setClearStoredKey(false)
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
    apiKeyDraft.trim() !== "" ||
    clearStoredKey

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
    }
    if (apiKeyDraft.trim()) {
      payload.webSearchApiKey = apiKeyDraft.trim()
    } else if (clearStoredKey) {
      payload.webSearchApiKey = ""
    }
    await updateSystemSettings(payload)
    setApiKeyDraft("")
    setClearStoredKey(false)
    toast({ title: "联网搜索设置已保存" })
  }

  return (
    <Card className="p-5 space-y-5 border-0">
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

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium" htmlFor="web-search-key">
            API Key
          </label>
          <span className="text-xs text-muted-foreground">
            {systemSettings.webSearchHasApiKey && !clearStoredKey ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="web-search-key"
            type="password"
            value={apiKeyDraft}
            placeholder="留空表示不修改"
            onChange={(e)=>{
              setApiKeyDraft(e.target.value)
              if (clearStoredKey) setClearStoredKey(false)
            }}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={()=>{
              setApiKeyDraft("")
              setClearStoredKey(true)
            }}
            disabled={!systemSettings.webSearchHasApiKey && !clearStoredKey}
          >
            清除已保存
          </Button>
        </div>
        {clearStoredKey && (
          <p className="text-xs text-destructive">保存后将删除现有 API Key。</p>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={!changed || !limitValid || engine.trim() === ""}>
          保存联网搜索设置
        </Button>
      </div>
    </Card>
  )
}
