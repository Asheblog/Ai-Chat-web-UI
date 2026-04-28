"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { AlertDialog } from "@/components/ui/alert-dialog"
import { DestructiveConfirmDialogContent } from "@/components/ui/destructive-confirm-dialog"
import type { SystemConnectionGroup } from "@/services/system-connections"
import {
  SPECIAL_PROVIDER_OPENAI_INTERLEAVE,
  useSystemConnections,
} from "@/components/settings/system-connections/use-system-connections"
import { SystemConnectionEditor } from "@/components/settings/system-connections/SystemConnectionEditor"
import { SystemConnectionList } from "@/components/settings/system-connections/SystemConnectionList"
import {
  SystemConnectionsToolbar,
  type ConnectionStats,
} from "@/components/settings/system-connections/SystemConnectionsToolbar"
import {
  filterConnections,
  getEnabledKeyCount,
  getGroupHealth,
  providerLabel,
  type DetailIntent,
  type EditorFocus,
} from "@/components/settings/system-connections/view-model"

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
  const deferredQuery = useDeferredValue(query)
  const [providerFilter, setProviderFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [healthFilter, setHealthFilter] = useState("all")
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null)
  const [detailIntent, setDetailIntent] = useState<DetailIntent>("view")
  const [editorFocus, setEditorFocus] = useState<EditorFocus>("basic")
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const expandedGroup = useMemo(
    () => connections.find((group) => group.id === expandedGroupId) || null,
    [connections, expandedGroupId],
  )

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
    if (!expandedGroupId) return
    if (connections.some((group) => group.id === expandedGroupId)) return
    setExpandedGroupId(null)
    cancelEdit()
  }, [cancelEdit, connections, expandedGroupId])

  useEffect(() => {
    if (detailIntent !== "view" || !expandedGroup || editing?.id === expandedGroup.id) return
    startEdit(expandedGroup)
  }, [detailIntent, editing?.id, expandedGroup, startEdit])

  const handleProviderChange = (value: string) => {
    setForm((prev) => {
      const forceBearer = value === "google_genai" || value === SPECIAL_PROVIDER_OPENAI_INTERLEAVE
      return {
        ...prev,
        provider: value,
        authType: forceBearer ? "bearer" : prev.authType,
      }
    })
  }

  const openGroup = (group: SystemConnectionGroup, focus: EditorFocus = "basic") => {
    setDetailIntent("view")
    setEditorFocus(focus)
    setExpandedGroupId(group.id)
    startEdit(group)
  }

  const toggleGroup = (group: SystemConnectionGroup, focus: EditorFocus = "basic") => {
    if (detailIntent === "view" && expandedGroupId === group.id) {
      setExpandedGroupId(null)
      cancelEdit()
      return
    }
    openGroup(group, focus)
  }

  const startCreate = () => {
    cancelEdit()
    setExpandedGroupId(null)
    setDetailIntent("create")
    setEditorFocus("basic")
  }

  const closeCreate = () => {
    setDetailIntent("view")
    cancelEdit()
  }

  const handleSubmit = async () => {
    const saved = await submitConnection()
    if (!saved) return false
    if (detailIntent === "create") {
      setDetailIntent("view")
    } else {
      setExpandedGroupId(null)
      cancelEdit()
    }
    return true
  }

  const firstKey = form.keys[0]

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
        onCreate={startCreate}
      />

      {detailIntent === "create" ? (
        <section className="v2-panel bg-white/92 p-4 shadow-none">
          <SystemConnectionEditor
            group={null}
            detailIntent="create"
            initialFocus={editorFocus}
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
            onSubmit={handleSubmit}
            onVerify={verifyConnection}
            onCancelCreate={closeCreate}
          />
        </section>
      ) : null}

      <SystemConnectionList
        connections={filteredConnections}
        loading={loading}
        expandedGroupId={detailIntent === "view" ? expandedGroupId : null}
        onToggleGroup={toggleGroup}
        onOpenGroup={openGroup}
        onDelete={setConfirmDeleteId}
        renderEditor={(group) => (
          <SystemConnectionEditor
            group={group}
            detailIntent="view"
            initialFocus={editorFocus}
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
            onSubmit={handleSubmit}
            onVerify={verifyConnection}
            onCancelCreate={closeCreate}
          />
        )}
      />
    </div>
  )
}

export default SystemConnectionsPage
