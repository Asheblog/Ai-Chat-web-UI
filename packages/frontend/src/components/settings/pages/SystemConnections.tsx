"use client"

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react"
import { LayoutGrid, PlugZap, Plus, Settings2 } from "lucide-react"
import { AlertDialog } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { DestructiveConfirmDialogContent } from "@/components/ui/destructive-confirm-dialog"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import type {
  SystemConnectionGroup,
  SystemConnectionsImportPayload,
} from "@/services/system-connections"
import {
  downloadConnectionsExport,
  exportSystemConnections,
  importSystemConnections,
} from "@/services/system-connections"
import {
  SPECIAL_PROVIDER_OPENAI_INTERLEAVE,
  useSystemConnections,
} from "@/components/settings/system-connections/use-system-connections"
import { SystemConnectionEditor } from "@/components/settings/system-connections/SystemConnectionEditor"
import { CollapsibleEditorSection } from "@/components/settings/system-connections/SystemConnectionEditorParts"
import { SystemConnectionList } from "@/components/settings/system-connections/SystemConnectionList"
import {
  SystemConnectionsToolbar,
  type ConnectionStats,
} from "@/components/settings/system-connections/SystemConnectionsToolbar"
import { ProviderTemplateCard } from "@/components/settings/system-connections/provider-template-card"
import {
  PROVIDER_TEMPLATES,
  type ProviderTemplate,
} from "@/components/settings/system-connections/provider-templates"
import {
  createFormFromTemplate,
  DEFAULT_FORM,
  createEmptyKey,
} from "@/components/settings/system-connections/form-state"
import {
  filterConnections,
  getEnabledKeyCount,
  getGroupHealth,
  providerLabel,
  type WizardMode,
  type WizardStep,
} from "@/components/settings/system-connections/view-model"

type SheetState =
  | { open: false }
  | { open: true; mode: WizardMode; step: WizardStep; title: string; description?: string }

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

  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [providerFilter, setProviderFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sheet, setSheet] = useState<SheetState>({ open: false })
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [confirmExportOpen, setConfirmExportOpen] = useState(false)
  const [confirmImportOpen, setConfirmImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPayload, setImportPayload] = useState<SystemConnectionsImportPayload | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stats = useMemo<ConnectionStats>(() => {
    const totalKeys = connections.reduce((sum, group) => sum + group.apiKeys.length, 0)
    const enabledKeys = connections.reduce((sum, group) => sum + getEnabledKeyCount(group), 0)
    const healthy = connections.filter((group) => getGroupHealth(group) === "healthy").length
    const warning = connections.filter((group) => getGroupHealth(group) === "warning").length
    const errorCount = connections.filter((group) => getGroupHealth(group) === "error").length
    return { totalGroups: connections.length, totalKeys, enabledKeys, healthy, warning, errorCount }
  }, [connections])

  const providerOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; keyCount: number }>()
    connections.forEach((group) => {
      const key = `${group.provider}:${group.vendor || ""}`
      const current = map.get(key)
      map.set(key, {
        key,
        label: providerLabel(group),
        count: (current?.count ?? 0) + 1,
        keyCount: (current?.keyCount ?? 0) + group.apiKeys.length,
      })
    })
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [connections])

  /** 模板卡数据：连接数按 `${provider}:${vendor||""}` 口径统计（与 providerOptions 同口径） */
  const templateCards = useMemo(() => {
    const countMap = new Map<string, number>()
    connections.forEach((group) => {
      const key = `${group.provider}:${group.vendor || ""}`
      countMap.set(key, (countMap.get(key) ?? 0) + 1)
    })
    return PROVIDER_TEMPLATES.map((template) => {
      const matchKey =
        template.provider === SPECIAL_PROVIDER_OPENAI_INTERLEAVE
          ? `openai:${SPECIAL_PROVIDER_OPENAI_INTERLEAVE}`
          : `${template.provider}:`
      return { template, count: countMap.get(matchKey) ?? 0 }
    })
  }, [connections])

  const filteredConnections = useMemo(
    () =>
      filterConnections({
        connections,
        healthFilter,
        providerFilter,
        query: deferredQuery,
        statusFilter,
      }),
    [connections, deferredQuery, healthFilter, providerFilter, statusFilter],
  )

  useEffect(() => {
    if (!successMessage) return
    const timer = window.setTimeout(() => setSuccessMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [successMessage])

  const displayError = pageError || error

  const parseImportFile = (raw: unknown): SystemConnectionsImportPayload => {
    if (!raw || typeof raw !== "object") {
      throw new Error("JSON 格式无效")
    }
    const json = raw as Record<string, unknown>
    if (json.schemaVersion !== 1 && json.schemaVersion !== 2) {
      throw new Error("不支持的 schemaVersion，当前仅支持版本 1/2")
    }
    if (!Array.isArray(json.connections)) {
      throw new Error("缺少 connections 数组")
    }
    return {
      schemaVersion: json.schemaVersion as 1,
      exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : undefined,
      connections: json.connections,
      skippedKeys: typeof json.skippedKeys === "number" ? json.skippedKeys : undefined,
      skippedReasons: Array.isArray(json.skippedReasons)
        ? json.skippedReasons.filter((item): item is string => typeof item === "string")
        : undefined,
    }
  }

  const handleExportRequest = () => {
    setConfirmExportOpen(true)
  }

  const handleExportConfirm = async () => {
    setConfirmExportOpen(false)
    setPageError(null)
    setExporting(true)
    try {
      const data = await exportSystemConnections()
      downloadConnectionsExport(data)
      const skippedHint =
        data.skippedKeys && data.skippedKeys > 0
          ? `，跳过 ${data.skippedKeys} 个无法解密的 Key`
          : ""
      setSuccessMessage(`已导出 ${data.connections.length} 个端点组${skippedHint}`)
    } catch (err: any) {
      setPageError(err?.response?.data?.error || err?.message || "导出失败")
    } finally {
      setExporting(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    setPageError(null)
    try {
      const text = await file.text()
      const parsed = parseImportFile(JSON.parse(text))
      setImportPayload(parsed)
      setConfirmImportOpen(true)
    } catch (err: any) {
      setPageError(err?.message || "无法解析导入文件")
    }
  }

  const handleImportConfirm = async () => {
    if (!importPayload) return
    setConfirmImportOpen(false)
    setPageError(null)
    setImporting(true)
    try {
      const result = await importSystemConnections(importPayload)
      const skippedHint =
        result.skippedKeys > 0 ? `，跳过 ${result.skippedKeys} 个 Key` : ""
      setSuccessMessage(
        `导入完成：新增 ${result.createdGroups} 组、更新 ${result.updatedGroups} 组、追加 ${result.addedKeys} 个 Key${skippedHint}`,
      )
      setImportPayload(null)
      await refresh()
    } catch (err: any) {
      setPageError(err?.response?.data?.error || err?.message || "导入失败")
    } finally {
      setImporting(false)
    }
  }

  const closeSheet = () => {
    setSheet({ open: false })
    cancelEdit()
  }

  /** 新建：从第 1 步选择供应商 */
  const openCreateWizard = () => {
    cancelEdit()
    setForm({
      ...DEFAULT_FORM,
      keys: [createEmptyKey(0)],
    })
    setSheet({
      open: true,
      mode: "create",
      step: 1,
      title: "新建连接",
      description: "三步完成：选供应商 → 填基础信息 → 验证保存",
    })
  }

  /** 模板卡：直接进入第 2 步 */
  const openTemplateWizard = (template: ProviderTemplate) => {
    cancelEdit()
    setForm(createFormFromTemplate(template))
    setSheet({
      open: true,
      mode: "create",
      step: 2,
      title: `配置 ${template.label}`,
      description: template.description,
    })
  }

  const openEditWizard = (group: SystemConnectionGroup) => {
    startEdit(group)
    setSheet({
      open: true,
      mode: "edit",
      step: 2,
      title: `编辑 ${group.displayName}`,
      description: `${providerLabel(group)} · ${group.baseUrl}`,
    })
  }

  const handleSelectTemplate = (template: ProviderTemplate) => {
    setForm(createFormFromTemplate(template))
    setSheet({
      open: true,
      mode: "create",
      step: 2,
      title: `配置 ${template.label}`,
      description: template.description,
    })
  }

  const handleStepChange = (step: WizardStep) => {
    setSheet((prev) => (prev.open ? { ...prev, step } : prev))
  }

  const handleSubmit = async () => {
    const saved = await submitConnection()
    if (!saved) return false
    closeSheet()
    return true
  }

  const firstKey = form.keys[0]
  const sheetOpen = sheet.open

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

      <AlertDialog open={confirmExportOpen} onOpenChange={setConfirmExportOpen}>
        <DestructiveConfirmDialogContent
          title="导出连接与密钥"
          description="将下载包含明文 API Key 的 JSON，仅用于环境迁移。"
          warning="文件含敏感凭据，勿提交到仓库或外传。"
          actionLabel={exporting ? "导出中..." : "确认导出"}
          actionDisabled={exporting}
          onAction={() => {
            void handleExportConfirm()
          }}
        />
      </AlertDialog>

      <AlertDialog
        open={confirmImportOpen}
        onOpenChange={(open) => {
          setConfirmImportOpen(open)
          if (!open) setImportPayload(null)
        }}
      >
        <DestructiveConfirmDialogContent
          title="导入连接与密钥"
          description={`将从 JSON 文件按端点签名合并导入 ${importPayload?.connections.length ?? 0} 个端点组；已存在端点仅追加新 Key，不删除已有连接。`}
          warning="请确认文件来源可信；导入会写入明文密钥到系统。"
          actionLabel={importing ? "导入中..." : "确认导入"}
          actionDisabled={importing}
          onAction={() => {
            void handleImportConfirm()
          }}
        />
      </AlertDialog>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFileChange}
      />

      {displayError ? (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {displayError}
        </div>
      ) : null}

      {successMessage ? (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-3">
          <PlugZap className="h-5 w-5 flex-shrink-0 text-primary" />
          <div className="space-y-1">
            <CardTitle>供应商与连接</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              用显示名称区分连接；通过向导完成接入与编辑
            </CardDescription>
          </div>
        </div>
        <Button onClick={openCreateWizard} className="h-10">
          <Plus className="mr-2 h-4 w-4" />
          新建连接
        </Button>
      </div>

      {/* 模板卡网格 */}
      <section aria-label="供应商模板" data-card-key="connections:quick-connect">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LayoutGrid className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">快速接入</h2>
            <p className="v2-muted-line mt-1">
              选择供应商卡片，预填默认端点后填写显示名称并验证保存。
            </p>
          </div>
        </div>
        {loading && connections.length === 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="v2-panel h-40 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templateCards.map(({ template, count }) => (
              <ProviderTemplateCard
                key={template.provider}
                template={template}
                count={count}
                onConfigure={openTemplateWizard}
              />
            ))}
          </div>
        )}
      </section>

      {/* 高级管理折叠：列表、导入导出 */}
      <div data-card-key="connections:advanced">
        <CollapsibleEditorSection
          icon={<Settings2 className="h-4 w-4" />}
          title="高级管理"
          summary="全部连接列表、导入导出与 API Key 池"
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((prev) => !prev)}
        >
          <div className="space-y-4">
            <SystemConnectionsToolbar
              stats={stats}
              providers={providerOptions}
              loading={loading}
              query={query}
              providerFilter={providerFilter}
              statusFilter={statusFilter}
              healthFilter={healthFilter}
              onQueryChange={setQuery}
              onProviderFilterChange={setProviderFilter}
              onStatusFilterChange={setStatusFilter}
              onHealthFilterChange={setHealthFilter}
              onRefresh={refresh}
              onImport={handleImportClick}
              onExport={handleExportRequest}
              onCreate={openCreateWizard}
              exporting={exporting}
              importing={importing}
            />

            <SystemConnectionList
              connections={filteredConnections}
              loading={loading}
              onEdit={openEditWizard}
              onDelete={setConfirmDeleteId}
            />
          </div>
        </CollapsibleEditorSection>
      </div>

      {/* 统一创建/编辑向导 Sheet */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) closeSheet()
        }}
      >
        <SheetContent
          side="right"
          dialogTitle={sheet.open ? sheet.title : "连接向导"}
          dialogDescription={sheet.open ? sheet.description : undefined}
          className="w-full max-w-xl"
        >
          {sheet.open ? (
            <SheetWizardShell title={sheet.title} description={sheet.description}>
              <SystemConnectionEditor
                mode={sheet.mode}
                step={sheet.step}
                onStepChange={handleStepChange}
                form={form}
                setForm={setForm}
                firstKey={firstKey}
                capabilities={capabilities}
                editing={editing}
                submitting={submitting}
                verifying={verifying}
                verifyResult={verifyResult}
                onSelectTemplate={handleSelectTemplate}
                onToggleCapability={toggleCapability}
                onAddKey={addKey}
                onRemoveKey={removeKey}
                onUpdateKey={updateKey}
                onSubmit={handleSubmit}
                onVerify={verifyConnection}
                onCancel={closeSheet}
              />
            </SheetWizardShell>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default SystemConnectionsPage

function SheetWizardShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/70 py-4 pl-5 pr-16">
        <div className="min-w-0">
          <h2 className="v2-section-title break-words">{title}</h2>
          {description ? <p className="v2-muted-line mt-0.5 text-xs">{description}</p> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  )
}
