"use client"
import { useCallback, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import { useModelsStore } from "@/store/models-store"
import {
  MODEL_CAP_KEYS,
  type ModelCapKey,
} from "./constants"
import {
  updateModelCapabilities,
  deleteModelOverrides,
  deleteAllModelOverrides,
  refreshModelCatalog,
} from "@/services/system-models"

export type ModelSortField = 'name' | 'provider'
export type ModelSortOrder = 'asc' | 'desc'

const keyOf = (model: any) => `${model.connectionId}:${model.id}`

const capabilityStateOf = (model: any): Record<ModelCapKey, boolean> => {
  const next = {} as Record<ModelCapKey, boolean>
  MODEL_CAP_KEYS.forEach((key) => {
    const value = model?.capabilities?.[key]
    next[key] = typeof value === 'boolean' ? value : false
  })
  return next
}

const hasCapability = (model: any, key: ModelCapKey) => Boolean(model?.capabilities?.[key])

const recommendTag = (model: any): string | null => {
  const key = `${model?.id || ''} ${model?.name || ''} ${model?.rawId || ''}`.toLowerCase()
  if (/reason|math|logic|deepseek-reasoner/.test(key)) return '推荐:推理/数学'
  if (/image-gen|image_generation|dall|sd|flux|kandinsky/.test(key)) return '推荐:图像生成'
  if (/vision|vl|4o|gpt-4o|omni|gpt-4v/.test(key)) return '推荐:多模态'
  if (/embed|embedding/.test(key)) return '推荐:嵌入/检索'
  return '推荐:通用对话'
}

export function useSystemModels() {
  const { models, isLoading, fetchAll } = useModelsStore()
  const { toast } = useToast()

  const [q, setQ] = useState('')
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [sortField, setSortField] = useState<ModelSortField>('name')
  const [sortOrder, setSortOrder] = useState<ModelSortOrder>('asc')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [savingKey, setSavingKey] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const filtered = (models || [])
      .filter((model: any) => {
        if (!kw) return true
        return [model.id, model.rawId, model.name, model.provider].some((value) =>
          String(value || '').toLowerCase().includes(kw)
        )
      })
      .filter((model: any) => (onlyOverridden ? model?.overridden : true))

    filtered.sort((a: any, b: any) => {
      let comparison = 0
      if (sortField === 'name') {
        comparison = (a.name || a.id || '').localeCompare(b.name || b.id || '')
      } else if (sortField === 'provider') {
        comparison = (a.provider || '').localeCompare(b.provider || '')
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [models, q, onlyOverridden, sortField, sortOrder])

  const toggleSort = (field: ModelSortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const buildCapabilityPayload = (model: any, key: ModelCapKey, value: boolean) => {
    const tags = Array.isArray(model.tags) ? model.tags.map((tag: any) => ({ name: String(tag?.name || '') })) : []
    const baseTags = tags.filter((tag: any) => !MODEL_CAP_KEYS.includes(tag.name as ModelCapKey))
    const enabledCaps = new Set<ModelCapKey>(MODEL_CAP_KEYS.filter((k) => hasCapability(model, k)) as ModelCapKey[])
    if (value) enabledCaps.add(key); else enabledCaps.delete(key)
    const capabilityState = capabilityStateOf(model)
    capabilityState[key] = value

    return {
      tags: baseTags.concat(Array.from(enabledCaps).map((k) => ({ name: k }))),
      capabilities: capabilityState,
    }
  }

  const handleToggleCapability = async (model: any, key: ModelCapKey, value: boolean) => {
    const payload = buildCapabilityPayload(model, key, value)
    try {
      setSavingKey(`${model.connectionId}:${model.id}`)
      await updateModelCapabilities(model.connectionId, model.rawId, payload.tags, payload.capabilities)
      await fetchAll()
      toast({ title: '能力已更新', description: `${model.name || model.id} 的能力配置已保存` })
    } catch (err: any) {
      toast({
        title: '更新失败',
        description: err?.message || '保存失败',
        variant: 'destructive',
      })
    } finally {
      setSavingKey('')
    }
  }

  const resetModel = async (model: any) => {
    try {
      await deleteModelOverrides([{ connectionId: model.connectionId, rawId: model.rawId }])
      await fetchAll()
      toast({ title: '已重置', description: `${model.name || model.id} 的覆写配置已清除` })
    } catch (err: any) {
      toast({
        title: '重置失败',
        description: err?.message || '操作失败',
        variant: 'destructive',
      })
    }
  }

  const manualRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshModelCatalog()
      await fetchAll()
      toast({ title: '已获取最新模型列表' })
    } catch (err: any) {
      toast({
        title: '刷新失败',
        description: err?.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setRefreshing(false)
    }
  }

  const handleClearAll = async () => {
    if (clearing) return
    setClearing(true)
    try {
      await deleteAllModelOverrides()
      await fetchAll()
      toast({ title: '已清除全部覆写' })
    } catch (err: any) {
      toast({
        title: '清除覆写失败',
        description: err?.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setClearing(false)
      setClearDialogOpen(false)
    }
  }

  const handleExport = () => {
    if (typeof window === 'undefined') return
    const overrides = (models || []).filter((model: any) => model.overridden)
    const items = overrides.map((model: any) => ({
      connectionId: model.connectionId,
      rawId: model.rawId,
      tags: model.tags || [],
      capabilities: model.capabilities || {},
      capabilitySource: model.capabilitySource || null,
    }))
    const blob = new Blob([JSON.stringify({ items }, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'model-capabilities-overrides.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    toast({ title: '已导出覆写配置', description: `共导出 ${items.length} 项配置` })
  }

  const handleImportFile = async (file: File) => {
    try {
      const txt = await file.text()
      const json = JSON.parse(txt)
      const items = Array.isArray(json?.items) ? json.items : []
      for (const item of items) {
        if (!item?.connectionId || !item?.rawId) continue
        let tags = Array.isArray(item?.tags) ? item.tags : []
        if ((!tags || tags.length === 0) && item?.capabilities && typeof item.capabilities === 'object') {
          const caps = item.capabilities
          const capTags = MODEL_CAP_KEYS.filter((key) => Boolean(caps[key])).map((key) => ({ name: key }))
          tags = capTags
        }
        let capPayload: Record<ModelCapKey, boolean> | undefined
        if (item?.capabilities && typeof item.capabilities === 'object') {
          capPayload = MODEL_CAP_KEYS.reduce((acc, key) => {
            if (typeof item.capabilities[key] === 'boolean') {
              acc[key] = Boolean(item.capabilities[key])
            }
            return acc
          }, {} as Record<ModelCapKey, boolean>)
          if (Object.keys(capPayload).length === 0) {
            capPayload = undefined
          }
        }
        await updateModelCapabilities(Number(item.connectionId), String(item.rawId), tags, capPayload)
      }
      await fetchAll()
      toast({ title: '导入完成', description: `共应用 ${items.length} 项覆写。` })
    } catch (err: any) {
      toast({
        title: '导入失败',
        description: err?.message || String(err),
        variant: 'destructive',
      })
    }
  }

  const toggleSelectAll = () => {
    if (selectedKeys.size === list.length && list.length > 0) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(list.map((model: any) => keyOf(model))))
    }
  }

  const toggleSelectRow = (key: string) => {
    const next = new Set(selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedKeys(next)
  }

  const clearSelection = () => setSelectedKeys(new Set())

  const handleBatchReset = async () => {
    const targets = list.filter((model: any) => selectedKeys.has(keyOf(model)))
    if (targets.length === 0) return
    try {
      await Promise.all(
        targets.map((model: any) => deleteModelOverrides([{ connectionId: model.connectionId, rawId: model.rawId }]))
      )
      await fetchAll()
      toast({ title: '批量重置成功', description: `已重置 ${targets.length} 个模型的覆写配置` })
      clearSelection()
    } catch (err: any) {
      toast({
        title: '批量重置失败',
        description: err?.message || '操作失败',
        variant: 'destructive',
      })
    }
  }

  const reload = useCallback(() => {
    fetchAll().catch(() => {})
  }, [fetchAll])

  return {
    list,
    isLoading,
    q,
    setQ,
    onlyOverridden,
    setOnlyOverridden,
    sortField,
    sortOrder,
    toggleSort,
    selectedKeys,
    toggleSelectAll,
    toggleSelectRow,
    clearSelection,
    savingKey,
    refreshing,
    manualRefresh,
    reload,
    clearDialogOpen,
    setClearDialogOpen,
    clearing,
    handleClearAll,
    handleExport,
    handleImportFile,
    handleToggleCapability,
    resetModel,
    handleBatchReset,
    hasCapability,
    capabilityStateOf,
    recommendTag,
  }
}
