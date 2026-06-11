"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  deleteSkill,
  installSkillFromStore,
  listSkillCatalog,
  listSkillStore,
} from "@/features/skills/api"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth-store"
import type { SkillCatalogItem, SkillStoreItem, SkillStoreSourceItem } from "@/types"
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react"

type ViewMode = "store" | "installed"

const ALL_SOURCES = "all"

const statusText = (status?: string | null) => {
  if (status === "approved") return "许可证通过"
  if (status === "source_available") return "来源条款"
  if (status === "blocked") return "已阻止"
  return "待检测"
}

const shortDescription = (value?: string | null) => {
  const normalized = (value || "").replace(/\s+/g, " ").trim()
  if (!normalized) return "来自内置合规清单的 GitHub Skill。"
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized
}

export function PersonalSkillsPage() {
  const { toast } = useToast()
  const actorState = useAuthStore((state) => state.actorState)
  const isAuthenticated = actorState === "authenticated"
  const [mode, setMode] = useState<ViewMode>("store")
  const [query, setQuery] = useState("")
  const [sourceKey, setSourceKey] = useState(ALL_SOURCES)
  const [storeItems, setStoreItems] = useState<SkillStoreItem[]>([])
  const [sources, setSources] = useState<SkillStoreSourceItem[]>([])
  const [installedSkills, setInstalledSkills] = useState<SkillCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const fetchData = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const [storeResponse, catalogResponse] = await Promise.all([
        listSkillStore({
          q: query.trim() || undefined,
          sourceKey: sourceKey === ALL_SOURCES ? undefined : sourceKey,
          refresh,
        }),
        isAuthenticated ? listSkillCatalog() : Promise.resolve(null),
      ])
      if (!storeResponse?.success || !storeResponse.data) {
        throw new Error(storeResponse?.error || "加载 Skill 商店失败")
      }
      setStoreItems(storeResponse.data.items)
      setSources(storeResponse.data.sources)
      const catalogItems = catalogResponse?.success && Array.isArray(catalogResponse.data)
        ? catalogResponse.data
        : []
      setInstalledSkills(
        catalogItems.filter((item) => item.visibility === "user_private" && item.sourceType === "github"),
      )
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "加载 Skill 数据失败")
      setStoreItems([])
      setInstalledSkills([])
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, query, sourceKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchData(false)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  const visibleInstalled = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return installedSkills
    return installedSkills.filter((item) =>
      [item.displayName, item.slug, item.sourceKey, item.licenseName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    )
  }, [installedSkills, query])

  const handleInstall = async (item: SkillStoreItem) => {
    if (!isAuthenticated || installingKey) return
    setInstallingKey(item.key)
    try {
      const response = await installSkillFromStore({ itemKey: item.key })
      if (!response?.success) {
        throw new Error(response?.error || "安装失败")
      }
      toast({ title: "Skill 已安装", description: `${item.displayName} 已加入你的个人 Skill。` })
      await fetchData(false)
    } catch (err: any) {
      toast({
        title: "安装失败",
        description: err?.response?.data?.error || err?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setInstallingKey(null)
    }
  }

  const handleDelete = async (skill: SkillCatalogItem) => {
    if (deletingId) return
    const confirmed = window.confirm(`卸载 ${skill.displayName || skill.slug}？已启用的会话绑定会一并失效。`)
    if (!confirmed) return
    setDeletingId(skill.id)
    try {
      const response = await deleteSkill(skill.id)
      if (!response?.success) {
        throw new Error(response?.error || "卸载失败")
      }
      toast({ title: "Skill 已卸载" })
      await fetchData(false)
    } catch (err: any) {
      toast({
        title: "卸载失败",
        description: err?.response?.data?.error || err?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="v2-panel overflow-hidden shadow-none">
      <div className="border-b border-border/70 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="v2-section-title">个人 Skills</h2>
              <span className="v2-status">{installedSkills.length} 个已安装</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              从内置合规清单安装 GitHub Skill；安装后只能由当前账号在聊天会话里启用。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid h-9 grid-cols-2 overflow-hidden rounded-[8px] border border-border bg-muted sm:w-[210px]">
              {(["store", "installed"] as ViewMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={cn(
                    "text-xs font-medium transition-colors",
                    mode === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70",
                  )}
                >
                  {item === "store" ? "商店" : "已安装"}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={loading}
              className="h-9"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", loading ? "animate-spin" : "")} />
              刷新
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Skill、来源或标签"
              className="h-10 bg-background pl-9"
            />
          </div>
          <Select value={sourceKey} onValueChange={setSourceKey}>
            <SelectTrigger className="h-10 bg-background">
              <SelectValue placeholder="全部来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SOURCES}>全部来源</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.key} value={source.key}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isAuthenticated ? (
          <Alert className="mt-4 border-amber-500/40 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>需要登录</AlertTitle>
            <AlertDescription>匿名用户可以查看商店，但不能安装或启用第三方 Skill。</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>同步失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {mode === "store" ? (
        <div className="divide-y divide-border/70">
          {storeItems.map((item) => {
            const installed = Boolean(item.installed?.skillId)
            const disabled = !isAuthenticated || !item.installable || installed || Boolean(installingKey)
            return (
              <div key={item.key} className="grid gap-3 p-4 transition-colors hover:bg-muted/25 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-sm font-semibold text-foreground">{item.displayName}</p>
                    {installed ? <Badge variant="secondary">已安装</Badge> : null}
                    <Badge variant="outline">{item.sourceName}</Badge>
                    <Badge variant="outline">{statusText(item.licenseStatus)}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{shortDescription(item.description)}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{item.repository}/{item.subdir}</span>
                    {item.licenseName ? <span>{item.licenseName}</span> : null}
                    <a href={item.skillUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      GitHub
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
                <div className="flex items-center justify-start gap-2 lg:justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={() => handleInstall(item)}
                    className="h-9 min-w-[96px]"
                    variant={installed ? "secondary" : "default"}
                  >
                    {installingKey === item.key ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : installed ? (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    ) : (
                      <PackageCheck className="mr-2 h-4 w-4" />
                    )}
                    {installed ? "已安装" : "安装"}
                  </Button>
                </div>
              </div>
            )
          })}
          {!loading && storeItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">没有匹配的 Skill。</div>
          ) : null}
        </div>
      ) : (
        <div className="divide-y divide-border/70">
          {visibleInstalled.map((skill) => (
            <div key={skill.id} className="grid gap-3 p-4 transition-colors hover:bg-muted/25 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-sm font-semibold text-foreground">{skill.displayName || skill.slug}</p>
                  <Badge variant="secondary">私有</Badge>
                  <Badge variant="outline">{skill.sourceKey || "github"}</Badge>
                  {skill.defaultVersion?.status ? <Badge variant="outline">{skill.defaultVersion.status}</Badge> : null}
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{shortDescription(skill.description)}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{skill.slug}</span>
                  {skill.defaultVersion?.version ? <span>v{skill.defaultVersion.version}</span> : null}
                  {skill.licenseName ? <span>{skill.licenseName}</span> : null}
                  {skill.sourceUrl ? (
                    <a href={skill.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      来源
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-start gap-2 lg:justify-end">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  仅当前账号
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={deletingId === skill.id}
                  onClick={() => handleDelete(skill)}
                  className="h-9 text-destructive hover:text-destructive"
                >
                  {deletingId === skill.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  卸载
                </Button>
              </div>
            </div>
          ))}
          {!loading && visibleInstalled.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">还没有安装个人 Skill。</div>
          ) : null}
        </div>
      )}
    </section>
  )
}

export default PersonalSkillsPage
