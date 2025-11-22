"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { useSystemModels } from "../system-models/use-system-models"
import type { SystemSettings } from "@/types"
import { RefreshCw, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

export function SystemModelAccessPage() {
  const { settings, isLoading: settingsLoading, update } = useSystemSettings()
  const { toast } = useToast()
  const {
    list,
    isLoading: modelsLoading,
    q,
    setQ,
    onlyOverridden,
    setOnlyOverridden,
    refreshing,
    manualRefresh,
    reload,
    batchUpdating,
    bulkUpdateAccessPolicy,
    handleUpdateAccessPolicy,
    recommendTag,
    accessOptions,
    savingKey,
  } = useSystemModels()

  const [allowAnonymous, setAllowAnonymous] = useState(false)
  const [allowUser, setAllowUser] = useState(true)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 80

  useEffect(() => {
    if (!settings) return
    setAllowAnonymous((settings.modelAccessDefaultAnonymous || "deny") === "allow")
    setAllowUser((settings.modelAccessDefaultUser || "allow") === "allow")
  }, [settings])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    setPage(1)
  }, [q, onlyOverridden, list.length])

  const totalPages = Math.max(1, Math.ceil((list.length || 0) / pageSize))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pagedList = useMemo(() => {
    const start = (page - 1) * pageSize
    return list.slice(start, start + pageSize)
  }, [list, page])

  const normalizedDefaults = useMemo(() => {
    if (!settings) return null
    return {
      allowAnonymous: (settings.modelAccessDefaultAnonymous || "deny") === "allow",
      allowUser: (settings.modelAccessDefaultUser || "allow") === "allow",
    }
  }, [settings])

  const isDefaultsDirty = useMemo(() => {
    if (!normalizedDefaults) return false
    return normalizedDefaults.allowAnonymous !== allowAnonymous || normalizedDefaults.allowUser !== allowUser
  }, [normalizedDefaults, allowAnonymous, allowUser])

  const handleSaveDefaults = async () => {
    if (!settings) return
    setSavingDefaults(true)
    try {
      const payload: Partial<SystemSettings> = {
        modelAccessDefaultAnonymous: allowAnonymous ? "allow" : "deny",
        modelAccessDefaultUser: allowUser ? "allow" : "deny",
      }
      await update(payload)
      toast({ title: "默认访问策略已保存" })
    } catch (err: any) {
      toast({
        title: "保存失败",
        description: err?.message || "更新默认访问策略失败",
        variant: "destructive",
      })
    } finally {
      setSavingDefaults(false)
    }
  }

  const renderRow = (model: any) => {
    const key = `${model.connectionId}:${model.id}`
    const isBusy = savingKey === key
    const anonymousDecision = model.resolvedAccess?.anonymous?.decision === "deny" ? "禁止" : "允许"
    const userDecision = model.resolvedAccess?.user?.decision === "deny" ? "禁止" : "允许"
    return (
      <div
        key={key}
        className="rounded-lg border border-muted px-4 py-3 bg-card/30 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="space-y-1">
          <div className="font-semibold text-base leading-tight">{model.name || model.id}</div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[11px] font-normal">
              {recommendTag(model)}
            </Badge>
            {model.provider && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {model.provider}
              </Badge>
            )}
            {model.capabilitySource && (
              <Badge
                variant="secondary"
                className="text-[10px] font-normal bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              >
                覆写:{model.capabilitySource}
              </Badge>
            )}
            {model.accessDecision === "deny" && (
              <Badge variant="destructive" className="text-[10px] font-normal">
                当前拒绝
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <AccessSelector
            label="匿名访问"
            current={anonymousDecision}
            value={(model.accessPolicy?.anonymous as any) || "inherit"}
            onChange={(v) => handleUpdateAccessPolicy(model, "anonymous", v as any)}
            disabled={isBusy}
            options={accessOptions}
          />
          <AccessSelector
            label="注册用户"
            current={userDecision}
            value={(model.accessPolicy?.user as any) || "inherit"}
            onChange={(v) => handleUpdateAccessPolicy(model, "user", v as any)}
            disabled={isBusy}
            options={accessOptions}
          />
        </div>
      </div>
    )
  }

  const loading = settingsLoading || modelsLoading

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <div>
          <div className="text-lg font-semibold">模型权限管理</div>
          <div className="text-sm text-muted-foreground">
            配置模型的默认访问策略，并为特定模型设置匿名/注册用户的访问控制。
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">默认访问策略</CardTitle>
          <p className="text-sm text-muted-foreground">
            未设置覆写的模型将继承默认策略。管理员始终可访问所有模型。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">允许匿名访问模型列表</div>
                <div className="text-sm text-muted-foreground">关闭后匿名用户无法看到模型或请求推理</div>
              </div>
              <Switch
                checked={allowAnonymous}
                onCheckedChange={(v) => setAllowAnonymous(Boolean(v))}
                disabled={settingsLoading}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">允许注册用户访问模型</div>
                <div className="text-sm text-muted-foreground">关闭后仅管理员可访问模型</div>
              </div>
              <Switch
                checked={allowUser}
                onCheckedChange={(v) => setAllowUser(Boolean(v))}
                disabled={settingsLoading}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <div className="text-xs text-muted-foreground">
              默认策略修改后立即应用到未覆写的模型
            </div>
            <Button
              onClick={handleSaveDefaults}
              disabled={!isDefaultsDirty || savingDefaults}
            >
              {savingDefaults ? "保存中..." : "保存默认策略"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">模型访问覆写</CardTitle>
          <p className="text-sm text-muted-foreground">
            为单个模型设置访问策略；不设置时继承默认策略。可按需刷新或筛选覆写记录。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">按名称/ID 搜索</Label>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="输入模型名称、ID 或提供商"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="only-overridden"
                checked={onlyOverridden}
                onCheckedChange={(v) => setOnlyOverridden(Boolean(v))}
              />
              <Label htmlFor="only-overridden" className="text-sm text-muted-foreground">
                仅看有覆写的模型
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={manualRefresh}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              {refreshing ? "刷新中..." : "手动获取最新"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              批量应用（当前筛选共 {list.length} 个，操作会遍历所有页）
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={batchUpdating || list.length === 0}
                onClick={() => bulkUpdateAccessPolicy(list, "anonymous", "allow")}
              >
                匿名-允许
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batchUpdating || list.length === 0}
                onClick={() => bulkUpdateAccessPolicy(list, "anonymous", "deny")}
              >
                匿名-禁止
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batchUpdating || list.length === 0}
                onClick={() => bulkUpdateAccessPolicy(list, "user", "allow")}
              >
                注册-允许
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batchUpdating || list.length === 0}
                onClick={() => bulkUpdateAccessPolicy(list, "user", "deny")}
              >
                注册-禁止
              </Button>
            </div>
            {batchUpdating && <span className="text-xs text-muted-foreground">批量更新中…</span>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>共 {list.length} 个模型，每页 {pageSize} 个</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span>第 {page} / {totalPages} 页</span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>

          {loading && (
            <div className="grid gap-3 md:grid-cols-2">
              {[...Array(4)].map((_, idx) => (
                <Card key={idx} className="shadow-none border-muted">
                  <CardContent className="pt-4 space-y-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Skeleton className="h-9" />
                      <Skeleton className="h-9" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!loading && list.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-10">
              暂无模型数据，尝试刷新或检查连接配置。
            </div>
          )}

          {!loading && pagedList.length > 0 && (
            <div className="space-y-3">
              {pagedList.map((model: any) => renderRow(model))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface AccessSelectorProps {
  label: string
  current: string
  value: "inherit" | "allow" | "deny"
  disabled?: boolean
  options: Array<{ value: "inherit" | "allow" | "deny"; label: string }>
  onChange: (value: "inherit" | "allow" | "deny") => void
}

function AccessSelector({ label, current, value, disabled, options, onChange }: AccessSelectorProps) {
  return (
    <div className="space-y-1.5 min-w-[180px]">
      <Label className="text-sm font-medium">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-sm">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="text-xs text-muted-foreground">当前：{current}</div>
    </div>
  )
}
