"use client"

import { useEffect, useMemo, useState } from "react"
import { useReducedMotion } from "framer-motion"
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  KeyRound,
  Loader2,
  MoreHorizontal,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AlertDialog } from "@/components/ui/alert-dialog"
import { DestructiveConfirmDialogContent } from "@/components/ui/destructive-confirm-dialog"
import type { SystemConnectionGroup } from "@/services/system-connections"
import {
  useSystemConnections,
  SPECIAL_PROVIDER_DEEPSEEK,
  SPECIAL_VENDOR_DEEPSEEK,
} from "@/components/settings/system-connections/use-system-connections"
import {
  CONNECTION_CAP_KEYS,
  CONNECTION_CAP_LABELS,
} from "@/components/settings/system-connections/constants"
import { SystemConnectionKeyPool } from "@/components/settings/system-connections/SystemConnectionKeyPool"
import { SystemConnectionVerifyPanel } from "@/components/settings/system-connections/SystemConnectionVerifyPanel"
import { Field, HelperText } from "@/components/settings/system-connections/SystemConnectionsPageParts"
import { cn, deriveChannelName, formatDate } from "@/lib/utils"

type HealthState = "healthy" | "warning" | "error"
type DetailTab = "basic" | "advanced"
type DetailIntent = "view" | "create"

const STATUS_FILTERS = [
  { value: "all", label: "全部状态" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
]

const HEALTH_FILTERS = [
  { value: "all", label: "全部健康" },
  { value: "healthy", label: "健康" },
  { value: "warning", label: "警告" },
  { value: "error", label: "异常" },
]

const providerLabel = (group: Pick<SystemConnectionGroup, "provider" | "vendor">) => {
  if (group.vendor === SPECIAL_VENDOR_DEEPSEEK) return "DeepSeek"
  if (group.provider === "azure_openai") return "Azure"
  if (group.provider === "google_genai") return "Google"
  if (group.provider === "ollama") return "Ollama"
  if (group.provider === "openai_responses") return "OpenAI Responses"
  if (group.provider === "openai") return "OpenAI"
  return group.provider || "Provider"
}

const getGroupHealth = (group: SystemConnectionGroup): HealthState => {
  if (group.apiKeys.length === 0) return "error"
  const enabledCount = group.apiKeys.filter((key) => key.enable).length
  if (enabledCount === 0) return "error"
  if (enabledCount < group.apiKeys.length) return "warning"
  return "healthy"
}

const getModelCount = (group: SystemConnectionGroup) => {
  const models = new Set<string>()
  group.apiKeys.forEach((key) => key.modelIds.forEach((id) => models.add(id)))
  return models.size
}

const healthLabel: Record<HealthState, string> = {
  healthy: "健康",
  warning: "警告",
  error: "异常",
}

const baseUrlPlaceholder = (provider: string) => {
  if (provider === SPECIAL_PROVIDER_DEEPSEEK) return "https://api.deepseek.com/v1"
  if (provider === "ollama") return "http://localhost:11434"
  if (provider === "google_genai") return "https://generativelanguage.googleapis.com/v1beta"
  return "https://api.openai.com/v1"
}

export function SystemConnectionsPage() {
  const {
    connections,
    loading,
    submitting,
    verifying,
    deletingId,
    error,
    form,
    setForm,
    capabilities,
    editing,
    verifyResult,
    refresh,
    startEdit,
    cancelEdit,
    addKey,
    removeKey,
    updateKey,
    submitConnection,
    verifyConnection,
    removeConnection,
    toggleCapability,
  } = useSystemConnections()

  const reducedMotion = useReducedMotion()
  const [query, setQuery] = useState("")
  const [providerFilter, setProviderFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>("basic")
  const [detailIntent, setDetailIntent] = useState<DetailIntent>("view")
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const selectedGroup = useMemo(
    () => connections.find((group) => group.id === selectedGroupId) || null,
    [connections, selectedGroupId],
  )

  const stats = useMemo(() => {
    const totalKeys = connections.reduce((sum, group) => sum + group.apiKeys.length, 0)
    const healthy = connections.filter((group) => getGroupHealth(group) === "healthy").length
    const warning = connections.filter((group) => getGroupHealth(group) === "warning").length
    const errorCount = connections.filter((group) => getGroupHealth(group) === "error").length
    return { totalKeys, healthy, warning, errorCount }
  }, [connections])

  const providerOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>()
    connections.forEach((group) => {
      const label = providerLabel(group)
      const key = `${group.provider}:${group.vendor || ""}`
      const current = map.get(key)
      map.set(key, {
        key,
        label,
        count: (current?.count ?? 0) + group.apiKeys.length,
      })
    })
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [connections])

  const filteredConnections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return connections.filter((group) => {
      const providerKey = `${group.provider}:${group.vendor || ""}`
      if (providerFilter !== "all" && providerKey !== providerFilter) return false

      const enabledCount = group.apiKeys.filter((key) => key.enable).length
      if (statusFilter === "enabled" && enabledCount === 0) return false
      if (statusFilter === "disabled" && enabledCount > 0) return false

      const health = getGroupHealth(group)
      if (healthFilter !== "all" && health !== healthFilter) return false

      if (!normalizedQuery) return true
      const searchable = [
        providerLabel(group),
        group.provider,
        group.baseUrl,
        group.prefixId ?? "",
        deriveChannelName(group.provider, group.baseUrl),
        ...group.tags.map((tag) => tag.name),
        ...group.apiKeys.map((key) => key.apiKeyLabel || ""),
      ]
      return searchable.some((value) => value.toLowerCase().includes(normalizedQuery))
    })
  }, [connections, healthFilter, providerFilter, query, statusFilter])

  useEffect(() => {
    if (connections.length === 0) {
      if (detailIntent === "view") {
        setSelectedGroupId(null)
      }
      return
    }
    if (selectedGroupId && connections.some((group) => group.id === selectedGroupId)) return
    const first = connections[0]
    setSelectedGroupId(first.id)
    setDetailIntent("view")
    setDetailTab("basic")
    startEdit(first)
  }, [connections, detailIntent, selectedGroupId, startEdit])

  const handleProviderChange = (value: string) => {
    setForm((prev) => {
      const isGoogle = value === "google_genai"
      const isDeepseek = value === SPECIAL_PROVIDER_DEEPSEEK
      const next = {
        ...prev,
        provider: value,
        authType: isGoogle || isDeepseek ? "bearer" : prev.authType,
      }
      if (isDeepseek && (!prev.baseUrl || prev.provider !== SPECIAL_PROVIDER_DEEPSEEK)) {
        next.baseUrl = "https://api.deepseek.com/v1"
      }
      return next
    })
  }

  const openGroup = (group: SystemConnectionGroup, tab: DetailTab = "basic") => {
    setSelectedGroupId(group.id)
    setDetailIntent("view")
    setDetailTab(tab)
    startEdit(group)
  }

  const startCreate = () => {
    cancelEdit()
    setSelectedGroupId(null)
    setDetailIntent("create")
    setDetailTab("basic")
  }

  const closeCreate = () => {
    setDetailIntent("view")
    if (selectedGroup) {
      startEdit(selectedGroup)
    } else {
      cancelEdit()
    }
  }

  const firstKey = form.keys[0]
  const panelTitle = detailIntent === "create" ? "新增连接" : "连接详情"
  const panelGroup = detailIntent === "create" ? null : selectedGroup

  return (
    <div className="min-w-0 space-y-5">
      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DestructiveConfirmDialogContent
          title="删除连接"
          description="该操作会删除这个 API 端点下的所有 Key 条目，并清空相关模型目录缓存。"
          warning="删除后不会保留回滚入口，请确认当前不是仍在使用的生产端点。"
          actionLabel={deletingId === confirmDeleteId ? "删除中..." : "确认删除"}
          actionDisabled={deletingId === confirmDeleteId}
          onAction={() => {
            if (confirmDeleteId != null) {
              void removeConnection(confirmDeleteId)
            }
            setConfirmDeleteId(null)
          }}
        />
      </AlertDialog>

      {error ? (
        <div role="alert" className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {error}
        </div>
      ) : null}

      <section className="v2-panel bg-white/90 px-4 py-3 shadow-none">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ConnectionStat icon={<PlugZap className="h-4 w-4" />} label="全部连接" value={stats.totalKeys} />
          <ConnectionStat icon={<CheckCircle2 className="h-4 w-4" />} label="健康" value={stats.healthy} tone="success" />
          <ConnectionStat icon={<AlertTriangle className="h-4 w-4" />} label="警告" value={stats.warning} tone="warning" />
          <ConnectionStat icon={<X className="h-4 w-4" />} label="异常" value={stats.errorCount} tone="danger" />
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[200px_minmax(0,1fr)_360px] 2xl:grid-cols-[220px_minmax(0,1fr)_408px]">
        <aside className="v2-panel min-w-0 bg-white/90 p-3 shadow-none">
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-slate-900">提供商</h2>
            <Button type="button" variant="ghost" size="icon" onClick={startCreate} className="h-8 w-8" aria-label="新增连接">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1.5">
            <ProviderButton
              active={providerFilter === "all"}
              label="全部"
              count={stats.totalKeys}
              onClick={() => setProviderFilter("all")}
            />
            {providerOptions.map((provider) => (
              <ProviderButton
                key={provider.key}
                active={providerFilter === provider.key}
                label={provider.label}
                count={provider.count}
                onClick={() => setProviderFilter(provider.key)}
              />
            ))}
          </div>
        </aside>

        <div className="v2-panel min-w-0 overflow-hidden bg-white/90 shadow-none">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(220px,1fr)_150px_150px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索连接名称、端点或标签"
                  className="h-10 bg-white pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={healthFilter} onValueChange={setHealthFilter}>
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEALTH_FILTERS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={refresh} disabled={loading} className="h-10 bg-white">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                刷新
              </Button>
              <Button onClick={startCreate} className="h-10">
                <Plus className="mr-2 h-4 w-4" />
                添加密钥
              </Button>
            </div>
          </div>

          <ConnectionTable
            connections={filteredConnections}
            loading={loading}
            selectedGroupId={selectedGroupId}
            onOpen={openGroup}
            onDelete={setConfirmDeleteId}
          />
        </div>

        <ConnectionDetailPanel
          title={panelTitle}
          group={panelGroup}
          detailIntent={detailIntent}
          detailTab={detailTab}
          setDetailTab={setDetailTab}
          form={form}
          setForm={setForm}
          firstKey={firstKey}
          capabilities={capabilities}
          editing={editing}
          submitting={submitting}
          verifying={verifying}
          verifyResult={verifyResult}
          reducedMotion={Boolean(reducedMotion)}
          onProviderChange={handleProviderChange}
          onToggleCapability={toggleCapability}
          onAddKey={addKey}
          onRemoveKey={removeKey}
          onUpdateKey={updateKey}
          onSubmit={submitConnection}
          onVerify={verifyConnection}
          onCancelCreate={closeCreate}
        />
      </section>
    </div>
  )
}

function ConnectionStat({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone?: "neutral" | "success" | "warning" | "danger"
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 bg-emerald-50"
      : tone === "warning"
        ? "text-amber-600 bg-amber-50"
        : tone === "danger"
          ? "text-red-600 bg-red-50"
          : "text-blue-600 bg-blue-50"
  return (
    <div className="flex items-center gap-3 border-r border-slate-200/70 last:border-r-0 xl:px-4">
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", toneClass)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-0.5 text-base font-semibold text-slate-950">{value}</div>
      </div>
    </div>
  )
}

function ProviderButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-[8px] px-3 py-3 text-left text-sm transition-colors",
        active ? "bg-blue-50 text-primary" : "text-slate-600 hover:bg-blue-50/70 hover:text-slate-950",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Server className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>
    </button>
  )
}

function ConnectionTable({
  connections,
  loading,
  selectedGroupId,
  onOpen,
  onDelete,
}: {
  connections: SystemConnectionGroup[]
  loading: boolean
  selectedGroupId: number | null
  onOpen: (group: SystemConnectionGroup, tab?: DetailTab) => void
  onDelete: (id: number) => void
}) {
  if (loading && connections.length === 0) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-14 rounded-[8px] bg-slate-100" />
        ))}
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center text-sm text-slate-500">
          暂无连接。请添加 Provider 和 API Key 后再验证模型。
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/75 text-xs text-slate-500">
            <th className="px-5 py-3 font-medium">名称</th>
            <th className="px-5 py-3 font-medium">状态</th>
            <th className="px-5 py-3 font-medium">模型数</th>
            <th className="px-5 py-3 font-medium">健康状态</th>
            <th className="px-5 py-3 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {connections.map((group) => {
            const health = getGroupHealth(group)
            const enabledCount = group.apiKeys.filter((key) => key.enable).length
            const selected = selectedGroupId === group.id
            return (
              <tr
                key={group.id}
                className={cn(
                  "border-b border-slate-100 transition-colors last:border-b-0",
                  selected ? "bg-cyan-50/70" : "bg-white/70 hover:bg-blue-50/45",
                )}
              >
                <td className="px-5 py-4">
                  <button type="button" onClick={() => onOpen(group)} className="block max-w-[280px] text-left">
                    <span className="block truncate font-medium text-slate-900">{deriveChannelName(group.provider, group.baseUrl)}</span>
                    <span className="mt-1 block truncate text-xs text-slate-500">{group.baseUrl}</span>
                  </button>
                </td>
                <td className="px-5 py-4">
                  <span className={enabledCount > 0 ? "v2-status v2-status-success" : "v2-status"}>
                    {enabledCount > 0 ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-600">{getModelCount(group) || group.apiKeys.length}</td>
                <td className="px-5 py-4">
                  <span
                    className={cn(
                      "v2-status",
                      health === "healthy" ? "v2-status-success" : health === "warning" ? "v2-status-warning" : "v2-status-danger",
                    )}
                  >
                    {healthLabel[health]}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button variant="ghost" size="icon" onClick={() => onOpen(group, "basic")} className="h-8 w-8" aria-label="查看连接详情">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onOpen(group, "advanced")} className="h-8 w-8" aria-label="编辑连接">
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(group.id)}
                      className="h-8 w-8 text-red-600 hover:text-red-700"
                      aria-label="删除连接"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ConnectionDetailPanel({
  title,
  group,
  detailIntent,
  detailTab,
  setDetailTab,
  form,
  setForm,
  firstKey,
  capabilities,
  editing,
  submitting,
  verifying,
  verifyResult,
  reducedMotion,
  onProviderChange,
  onToggleCapability,
  onAddKey,
  onRemoveKey,
  onUpdateKey,
  onSubmit,
  onVerify,
  onCancelCreate,
}: {
  title: string
  group: SystemConnectionGroup | null
  detailIntent: DetailIntent
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  form: ReturnType<typeof useSystemConnections>["form"]
  setForm: ReturnType<typeof useSystemConnections>["setForm"]
  firstKey: ReturnType<typeof useSystemConnections>["form"]["keys"][number] | undefined
  capabilities: ReturnType<typeof useSystemConnections>["capabilities"]
  editing: ReturnType<typeof useSystemConnections>["editing"]
  submitting: boolean
  verifying: boolean
  verifyResult: ReturnType<typeof useSystemConnections>["verifyResult"]
  reducedMotion: boolean
  onProviderChange: (value: string) => void
  onToggleCapability: ReturnType<typeof useSystemConnections>["toggleCapability"]
  onAddKey: () => void
  onRemoveKey: ReturnType<typeof useSystemConnections>["removeKey"]
  onUpdateKey: ReturnType<typeof useSystemConnections>["updateKey"]
  onSubmit: () => Promise<void>
  onVerify: () => Promise<void>
  onCancelCreate: () => void
}) {
  const modelIds = group
    ? Array.from(new Set(group.apiKeys.flatMap((key) => key.modelIds))).slice(0, 4)
    : firstKey?.modelIds.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 4) ?? []

  if (!group && detailIntent === "view") {
    return (
      <aside className="v2-panel min-w-0 bg-white/90 p-5 shadow-none">
        <h2 className="text-lg font-semibold text-slate-950">连接详情</h2>
        <div className="mt-5 rounded-[8px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500">
          选择一条连接后查看详情。
        </div>
      </aside>
    )
  }

  return (
    <aside className="v2-panel min-w-0 overflow-hidden bg-white/95 shadow-none xl:sticky xl:top-6 xl:max-h-[calc(100vh-96px)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {detailIntent === "create" ? (
          <Button variant="ghost" size="icon" onClick={onCancelCreate} className="h-8 w-8" aria-label="关闭新增连接">
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="max-h-[inherit] overflow-y-auto px-5 py-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xl font-semibold text-slate-950">
              {detailIntent === "create" ? "新连接" : group ? deriveChannelName(group.provider, group.baseUrl) : "连接"}
            </div>
            {group ? (
              <span
                className={cn(
                  "v2-status",
                  getGroupHealth(group) === "healthy"
                    ? "v2-status-success"
                    : getGroupHealth(group) === "warning"
                      ? "v2-status-warning"
                      : "v2-status-danger",
                )}
              >
                {healthLabel[getGroupHealth(group)]}
              </span>
            ) : null}
          </div>
          {group ? (
            <div className="space-y-1 text-xs text-slate-500">
              <div>创建于 {formatDate(group.createdAt)}</div>
              <div>最后更新 {formatDate(group.updatedAt)}</div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">填写基础信息后保存为新的 Provider 连接。</div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 border-b border-slate-200 text-sm font-medium">
          <button
            type="button"
            onClick={() => setDetailTab("basic")}
            className={cn("border-b-2 px-3 py-3 transition-colors", detailTab === "basic" ? "border-primary text-primary" : "border-transparent text-slate-500")}
          >
            基本信息
          </button>
          <button
            type="button"
            onClick={() => setDetailTab("advanced")}
            className={cn("border-b-2 px-3 py-3 transition-colors", detailTab === "advanced" ? "border-primary text-primary" : "border-transparent text-slate-500")}
          >
            高级设置
          </button>
        </div>

        {detailTab === "basic" ? (
          <div className="mt-5 space-y-4">
            <Field label="Provider" htmlFor="connection-provider">
              <Select value={form.provider} onValueChange={onProviderChange}>
                <SelectTrigger id="connection-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openai_responses">OpenAI（Responses）</SelectItem>
                  <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="google_genai">Google Generative AI</SelectItem>
                  <SelectItem value={SPECIAL_PROVIDER_DEEPSEEK}>DeepSeek（交错思考）</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="名称 / Prefix ID" htmlFor="connection-prefix">
              <Input
                id="connection-prefix"
                value={form.prefixId}
                onChange={(event) => setForm((prev) => ({ ...prev, prefixId: event.target.value }))}
                placeholder="OpenAI-主力"
              />
            </Field>

            <Field label="API Key" htmlFor="connection-api-key">
              <Input
                id="connection-api-key"
                type="password"
                value={firstKey?.apiKey ?? ""}
                onChange={(event) => {
                  if (!firstKey) return
                  onUpdateKey(firstKey.clientId, (current) => ({ ...current, apiKey: event.target.value }))
                }}
                placeholder={firstKey?.hasStoredApiKey ? "留空则继续使用已保存的 Key" : "sk-..."}
              />
              {firstKey?.apiKeyMasked ? <p className="text-xs text-slate-500">当前摘要：{firstKey.apiKeyMasked}</p> : null}
            </Field>

            <Field label="API 端点" htmlFor="connection-base-url">
              <Input
                id="connection-base-url"
                value={form.baseUrl}
                onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                placeholder={baseUrlPlaceholder(form.provider)}
              />
              <HelperText provider={form.provider} specialProviderDeepseek={SPECIAL_PROVIDER_DEEPSEEK} />
            </Field>

            <Field label="标签 / 备注" htmlFor="connection-tags">
              <Textarea
                id="connection-tags"
                value={form.tags}
                onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
                placeholder="prod,team-a,main"
                className="min-h-[78px]"
              />
            </Field>

            <div>
              <Label>模型</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {modelIds.length > 0 ? (
                  <>
                    {modelIds.map((modelId) => (
                      <span key={modelId} className="rounded-[8px] bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                        {modelId}
                      </span>
                    ))}
                    {group && getModelCount(group) > modelIds.length ? (
                      <span className="rounded-[8px] bg-slate-100 px-2.5 py-1 text-xs text-slate-600">+{getModelCount(group) - modelIds.length}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-sm text-slate-500">自动枚举或未配置显式模型</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="认证方式" htmlFor="connection-auth-type">
                <Select
                  value={form.authType}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, authType: value }))}
                  disabled={form.provider === "google_genai"}
                >
                  <SelectTrigger id="connection-auth-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="bearer">Bearer</SelectItem>
                    <SelectItem value="session">Session</SelectItem>
                    <SelectItem value="system_oauth">System OAuth</SelectItem>
                    <SelectItem value="microsoft_entra_id">Entra ID</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="连接类型" htmlFor="connection-type">
                <Select
                  value={form.connectionType}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, connectionType: value }))}
                >
                  <SelectTrigger id="connection-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external">external</SelectItem>
                    <SelectItem value="local">local</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {form.provider === "azure_openai" ? (
              <Field label="API Version" htmlFor="connection-azure-version">
                <Input
                  id="connection-azure-version"
                  value={form.azureApiVersion}
                  onChange={(event) => setForm((prev) => ({ ...prev, azureApiVersion: event.target.value }))}
                  placeholder="2024-02-15-preview"
                />
              </Field>
            ) : null}

            <div className="space-y-2 border-t border-slate-200 pt-4">
              <Label>默认能力</Label>
              <div className="flex flex-wrap gap-2">
                {CONNECTION_CAP_KEYS.map((key) => (
                  <label
                    key={key}
                    className={cn(
                      "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-1.5 text-sm transition-colors",
                      capabilities[key]
                        ? "border-primary/35 bg-primary/10 text-foreground"
                        : "border-border/70 bg-background/90 hover:bg-[hsl(var(--surface-hover))]",
                    )}
                  >
                    <Checkbox checked={capabilities[key]} onCheckedChange={(checked) => onToggleCapability(key, Boolean(checked))} />
                    <span>{CONNECTION_CAP_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>

            <SystemConnectionKeyPool
              keys={form.keys}
              reducedMotion={reducedMotion}
              onAddKey={onAddKey}
              onRemoveKey={onRemoveKey}
              onUpdateKey={onUpdateKey}
            />

            <SystemConnectionVerifyPanel verifyResult={verifyResult} reducedMotion={reducedMotion} />
          </div>
        )}

        <div className="mt-5 space-y-2 border-t border-slate-200 pt-4">
          <Button onClick={() => void onVerify()} variant="outline" disabled={submitting || verifying} className="w-full justify-center">
            {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            {verifying ? "验证中..." : "验证连接"}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting || verifying} className="w-full justify-center">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? "保存连接" : "创建连接"}
          </Button>
        </div>
      </div>
    </aside>
  )
}

export default SystemConnectionsPage
