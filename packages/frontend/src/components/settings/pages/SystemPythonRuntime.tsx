"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import {
  getPythonRuntimeStatus,
  installPythonRuntimeRequirements,
  reconcilePythonRuntime,
  uninstallPythonRuntimePackages,
  updatePythonRuntimeIndexes,
} from "@/features/settings/api"
import type { PythonRuntimeStatus } from "@/types"
import { FlaskConical } from "lucide-react"

const splitList = (raw: string) =>
  raw
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)

export function SystemPythonRuntimePage() {
  const { toast } = useToast()
  const [status, setStatus] = useState<PythonRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [indexUrlDraft, setIndexUrlDraft] = useState("")
  const [extraIndexesDraft, setExtraIndexesDraft] = useState("")
  const [trustedHostsDraft, setTrustedHostsDraft] = useState("")
  const [autoInstallOnActivateDraft, setAutoInstallOnActivateDraft] = useState(true)

  const [requirementsDraft, setRequirementsDraft] = useState("")
  const [uninstallDraft, setUninstallDraft] = useState("")

  const [savingIndexes, setSavingIndexes] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getPythonRuntimeStatus()
      const data = response.data as PythonRuntimeStatus
      setStatus(data)
      setIndexUrlDraft(data.indexes.indexUrl || "")
      setExtraIndexesDraft((data.indexes.extraIndexUrls || []).join("\n"))
      setTrustedHostsDraft((data.indexes.trustedHosts || []).join("\n"))
      setAutoInstallOnActivateDraft(Boolean(data.indexes.autoInstallOnActivate))
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || "加载 Python 运行环境失败"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus().catch(() => {})
  }, [loadStatus])

  const indexChanged = useMemo(() => {
    if (!status) return false
    return (
      indexUrlDraft.trim() !== (status.indexes.indexUrl || "") ||
      extraIndexesDraft.trim() !== (status.indexes.extraIndexUrls || []).join("\n") ||
      trustedHostsDraft.trim() !== (status.indexes.trustedHosts || []).join("\n") ||
      autoInstallOnActivateDraft !== Boolean(status.indexes.autoInstallOnActivate)
    )
  }, [
    autoInstallOnActivateDraft,
    extraIndexesDraft,
    indexUrlDraft,
    status,
    trustedHostsDraft,
  ])

  const handleSaveIndexes = async () => {
    if (!indexChanged || savingIndexes) return
    setSavingIndexes(true)
    try {
      await updatePythonRuntimeIndexes({
        indexUrl: indexUrlDraft.trim(),
        extraIndexUrls: splitList(extraIndexesDraft),
        trustedHosts: splitList(trustedHostsDraft),
        autoInstallOnActivate: autoInstallOnActivateDraft,
      })
      await loadStatus()
      toast({ title: "Python 索引配置已保存" })
    } catch (err: any) {
      toast({
        title: "保存失败",
        description: err?.response?.data?.error || err?.message || "更新 Python 索引配置失败",
        variant: "destructive",
      })
    } finally {
      setSavingIndexes(false)
    }
  }

  const handleInstall = async () => {
    if (installing) return
    const requirements = splitList(requirementsDraft)
    if (requirements.length === 0) {
      toast({ title: "请输入至少一个依赖", variant: "destructive" })
      return
    }

    setInstalling(true)
    try {
      await installPythonRuntimeRequirements({
        requirements,
        source: "manual",
      })
      setRequirementsDraft("")
      await loadStatus()
      toast({ title: "依赖安装完成" })
    } catch (err: any) {
      toast({
        title: "安装失败",
        description: err?.response?.data?.error || err?.message || "安装 Python 依赖失败",
        variant: "destructive",
      })
    } finally {
      setInstalling(false)
    }
  }

  const handleUninstall = async () => {
    if (uninstalling) return
    const packages = splitList(uninstallDraft)
    if (packages.length === 0) {
      toast({ title: "请输入至少一个包名", variant: "destructive" })
      return
    }

    setUninstalling(true)
    try {
      await uninstallPythonRuntimePackages({ packages })
      setUninstallDraft("")
      await loadStatus()
      toast({ title: "卸载完成" })
    } catch (err: any) {
      const details = err?.response?.data?.data?.details?.blocked
      const blockedTip = Array.isArray(details) && details.length > 0
        ? `，存在 ${details.length} 条激活 Skill 依赖占用`
        : ""
      toast({
        title: "卸载失败",
        description: (err?.response?.data?.error || err?.message || "卸载 Python 包失败") + blockedTip,
        variant: "destructive",
      })
    } finally {
      setUninstalling(false)
    }
  }

  const handleReconcile = async () => {
    if (reconciling) return
    setReconciling(true)
    try {
      await reconcilePythonRuntime()
      await loadStatus()
      toast({ title: "Reconcile 完成" })
    } catch (err: any) {
      toast({
        title: "Reconcile 失败",
        description: err?.response?.data?.error || err?.message || "运行环境校验失败",
        variant: "destructive",
      })
    } finally {
      setReconciling(false)
    }
  }

  if (loading && !status) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!status) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || "无法加载 Python 运行环境"}</p>
        <Button className="mt-3" variant="outline" onClick={() => loadStatus()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <FlaskConical className="h-5 w-5 text-primary" />
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">Python 运行环境</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            统一管理 `/app/data/python-runtime/venv` 中的依赖，并支持按激活 Skill 自动补装。
          </CardDescription>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-2">
        <p className="text-sm"><span className="font-medium">解释器路径：</span>{status.pythonPath}</p>
        <p className="text-sm"><span className="font-medium">运行时目录：</span>{status.runtimeRoot}</p>
        <div className="flex items-center gap-2">
          <Badge variant={status.ready ? "default" : "secondary"}>{status.ready ? "Ready" : "Not Ready"}</Badge>
          <Badge variant="outline">已安装 {status.installedPackages.length} 个包</Badge>
          <Badge variant="outline">手动保留 {Array.isArray(status.manualPackages) ? status.manualPackages.length : 0} 个包</Badge>
          <Badge variant="outline">激活依赖 {status.activeDependencies.length} 条</Badge>
          {status.conflicts.length > 0 ? <Badge variant="destructive">冲突 {status.conflicts.length}</Badge> : <Badge variant="outline">无冲突</Badge>}
        </div>
        {!status.ready && status.runtimeIssue?.message ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-medium">运行环境未就绪</p>
            <p className="mt-1 break-all">{status.runtimeIssue.message}</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium">索引配置</p>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">主索引（可选）</label>
          <Input
            value={indexUrlDraft}
            onChange={(e) => setIndexUrlDraft(e.target.value)}
            placeholder="https://pypi.org/simple"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">额外索引（每行一个）</label>
            <Textarea
              value={extraIndexesDraft}
              onChange={(e) => setExtraIndexesDraft(e.target.value)}
              rows={4}
              placeholder="https://pypi.tuna.tsinghua.edu.cn/simple"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">trusted-host（每行一个）</label>
            <Textarea
              value={trustedHostsDraft}
              onChange={(e) => setTrustedHostsDraft(e.target.value)}
              rows={4}
              placeholder="pypi.tuna.tsinghua.edu.cn"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm">激活 Skill 时自动安装 `python_packages`</label>
          <Button
            type="button"
            variant={autoInstallOnActivateDraft ? "default" : "outline"}
            onClick={() => setAutoInstallOnActivateDraft((v) => !v)}
          >
            {autoInstallOnActivateDraft ? "已开启" : "已关闭"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSaveIndexes} disabled={!indexChanged || savingIndexes}>
            {savingIndexes ? "保存中..." : "保存索引配置"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3">
          <p className="text-sm font-medium">安装依赖（手动）</p>
          <Textarea
            rows={5}
            value={requirementsDraft}
            onChange={(e) => setRequirementsDraft(e.target.value)}
            placeholder={"numpy==2.1.0\npandas>=2.2"}
          />
          <p className="text-xs text-muted-foreground">仅支持 PyPI 包名+版本约束，不支持 git/url/path。</p>
          <div className="flex justify-end">
            <Button onClick={handleInstall} disabled={installing || !status.ready}>
              {installing ? "安装中..." : "安装依赖"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3">
          <p className="text-sm font-medium">卸载包</p>
          <Textarea
            rows={5}
            value={uninstallDraft}
            onChange={(e) => setUninstallDraft(e.target.value)}
            placeholder={"numpy\npandas"}
          />
          <p className="text-xs text-muted-foreground">若包被激活 Skill 依赖占用，卸载会被阻断。</p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleUninstall} disabled={uninstalling || !status.ready}>
              {uninstalling ? "卸载中..." : "卸载"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">运行时一致性校验（Reconcile）</p>
          <Button variant="outline" onClick={handleReconcile} disabled={reconciling || !status.ready}>
            {reconciling ? "执行中..." : "立即执行"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">按当前激活 Skill 依赖补装并执行 `pip check`。</p>
      </div>

      {status.conflicts.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <p className="text-sm font-medium text-destructive">版本冲突告警</p>
          {status.conflicts.map((conflict) => (
            <div key={conflict.packageName} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{conflict.packageName}</span>
              {" -> "}
              {conflict.requirements.join(" | ")}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium">已安装包（前 200 项）</p>
        <div className="max-h-80 overflow-auto rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Package</th>
                <th className="px-3 py-2 text-left font-medium">Version</th>
              </tr>
            </thead>
            <tbody>
              {status.installedPackages.slice(0, 200).map((pkg) => (
                <tr key={`${pkg.name}-${pkg.version}`} className="border-t border-border/50">
                  <td className="px-3 py-1.5 font-mono text-xs">{pkg.name}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{pkg.version}</td>
                </tr>
              ))}
              {status.installedPackages.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={2}>暂无已安装包</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
