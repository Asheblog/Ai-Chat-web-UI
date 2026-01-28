"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import { useModelsStore } from "@/store/models-store"
import {
  MODEL_CAP_KEYS,
  MODEL_CAP_LABELS,
  type ModelCapKey,
} from "./constants"
import {
  updateModelCapabilities,
  deleteModelOverrides,
  deleteAllModelOverrides,
  refreshModelCatalog,
} from "@/services/system-models"

const ACCESS_OPTIONS: Array<{ value: 'inherit' | 'allow' | 'deny'; label: string }> = [
  { value: 'inherit', label: '继承默认' },
  { value: 'allow', label: '允许' },
  { value: 'deny', label: '禁止' },
]

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
  const [batchUpdating, setBatchUpdating] = useState(false)

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

  useEffect(() => {
    setSelectedKeys((prev) => {
      if (!prev.size) return prev
      const allowed = new Set(list.map((model: any) => keyOf(model)))
      const next = new Set<string>()
      prev.forEach((key) => {
        if (allowed.has(key)) next.add(key)
      })
      return next
    })
  }, [list])

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
      await updateModelCapabilities(model.connectionId, model.rawId, {
        tags: payload.tags,
        capabilities: payload.capabilities,
      })
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

  const handleSaveMaxTokens = async (model: any, rawValue: string) => {
    const key = keyOf(model)
    const trimmed = rawValue.trim()
    let payloadValue: number | null
    if (trimmed === '') {
      payloadValue = null
    } else {
      const parsed = Number.parseInt(trimmed, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        toast({
          title: 'max_tokens 无效',
          description: '请输入 1~256000 的整数，或留空使用默认值',
          variant: 'destructive',
        })
        return
      }
      payloadValue = Math.min(256000, parsed)
    }
    try {
      setSavingKey(key)
      await updateModelCapabilities(model.connectionId, model.rawId, { maxOutputTokens: payloadValue })
      await fetchAll()
      toast({
        title: '生成 Tokens 已更新',
        description: payloadValue ? `已限制为 ${payloadValue} tokens` : '已恢复供应商默认值',
      })
    } catch (err: any) {
      toast({
        title: '保存失败',
        description: err?.message || '更新生成 Tokens 失败',
        variant: 'destructive',
      })
    } finally {
      setSavingKey('')
    }
  }

  const handleSaveContextWindow = async (model: any, rawValue: string) => {
    const key = keyOf(model)
    const trimmed = rawValue.trim()
    let payloadValue: number | null
    if (trimmed === '') {
      payloadValue = null
    } else {
      const parsed = Number.parseInt(trimmed, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        toast({
          title: '上下文窗口无效',
          description: '请输入大于 0 的整数，或留空使用默认值',
          variant: 'destructive',
        })
        return
      }
      payloadValue = parsed
    }
    try {
      setSavingKey(key)
      await updateModelCapabilities(model.connectionId, model.rawId, { contextWindow: payloadValue })
      await fetchAll()
      toast({
        title: '上下文窗口已更新',
        description: payloadValue ? `已设置为 ${payloadValue.toLocaleString()} tokens` : '已恢复供应商默认值',
      })
    } catch (err: any) {
      toast({
        title: '保存失败',
        description: err?.message || '更新上下文窗口失败',
        variant: 'destructive',
      })
    } finally {
      setSavingKey('')
    }
  }

  const handleSaveTemperature = async (model: any, rawValue: string) => {
    const key = keyOf(model)
    const trimmed = rawValue.trim()
    let payloadValue: number | null
    if (trimmed === '') {
      payloadValue = null
    } else {
      const parsed = Number.parseFloat(trimmed)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        toast({
          title: '温度无效',
          description: '请输入 0~2 的数字，或留空使用默认值',
          variant: 'destructive',
        })
        return
      }
      payloadValue = parsed
    }
    try {
      setSavingKey(key)
      await updateModelCapabilities(model.connectionId, model.rawId, { temperature: payloadValue })
      await fetchAll()
      toast({
        title: '温度已更新',
        description: payloadValue !== null ? `已设置为 ${payloadValue}` : '已恢复供应商默认值',
      })
    } catch (err: any) {
      toast({
        title: '保存失败',
        description: err?.message || '更新温度失败',
        variant: 'destructive',
      })
    } finally {
      setSavingKey('')
    }
  }

  const handleUpdateAccessPolicy = async (
    model: any,
    target: 'anonymous' | 'user',
    value: 'inherit' | 'allow' | 'deny',
  ) => {
    const key = keyOf(model)
    try {
      setSavingKey(key)
      await updateModelCapabilities(model.connectionId, model.rawId, { accessPolicy: { [target]: value } })
      await fetchAll()
      toast({
        title: '访问策略已更新',
        description: `${model.name || model.id} 的${target === 'anonymous' ? '匿名访问' : '注册用户访问'}策略已保存`,
      })
    } catch (err: any) {
      toast({
        title: '保存失败',
        description: err?.message || '更新访问策略失败',
        variant: 'destructive',
      })
    } finally {
      setSavingKey('')
    }
  }

  const bulkUpdateAccessPolicy = async (
    models: any[],
    target: 'anonymous' | 'user',
    value: 'allow' | 'deny',
  ) => {
    if (!models.length) {
      toast({
        title: '无可更新项',
        description: '当前筛选没有匹配的模型',
        variant: 'destructive',
      })
      return
    }
    setBatchUpdating(true)
    try {
      let success = 0
      const failed: string[] = []
      for (const model of models) {
        try {
          await updateModelCapabilities(model.connectionId, model.rawId, { accessPolicy: { [target]: value } })
          success += 1
        } catch (err: any) {
          failed.push(model.name || model.id || `${model.connectionId}:${model.rawId}`)
        }
      }
      await fetchAll()
      toast({
        title: failed.length ? '批量更新部分成功' : '批量更新成功',
        description: `成功 ${success} 个，失败 ${failed.length} 个；已将${target === 'anonymous' ? '匿名访问' : '注册用户'}策略设为${value === 'allow' ? '允许' : '禁止'}`.slice(0, 140),
        variant: failed.length ? 'destructive' : 'default',
      })
      if (failed.length) {
        console.error('批量更新失败模型', failed)
      }
    } catch (err: any) {
      toast({
        title: '批量更新失败',
        description: err?.message || '保存失败',
        variant: 'destructive',
      })
    } finally {
      setBatchUpdating(false)
    }
  }

  const bulkUpdateCapability = async (models: any[], key: ModelCapKey, value: boolean) => {
    if (!models.length) {
      toast({
        title: '无可更新项',
        description: '当前筛选没有匹配的模型',
        variant: 'destructive',
      })
      return
    }
    setBatchUpdating(true)
    try {
      let success = 0
      const failed: string[] = []
      for (const model of models) {
        const payload = buildCapabilityPayload(model, key, value)
        try {
          await updateModelCapabilities(model.connectionId, model.rawId, {
            tags: payload.tags,
            capabilities: payload.capabilities,
          })
          success += 1
        } catch (err: any) {
          failed.push(model.name || model.id || `${model.connectionId}:${model.rawId}`)
        }
      }
      await fetchAll()
      toast({
        title: failed.length ? '批量更新部分成功' : '批量更新成功',
        description: `成功 ${success} 个，失败 ${failed.length} 个；已将 ${MODEL_CAP_LABELS[key]} 设为${value ? '开启' : '关闭'}`.slice(0, 140),
        variant: failed.length ? 'destructive' : 'default',
      })
      if (failed.length) {
        console.error('批量更新失败模型', failed)
      }
    } catch (err: any) {
      toast({
        title: '批量更新失败',
        description: err?.message || '保存失败',
        variant: 'destructive',
      })
    } finally {
      setBatchUpdating(false)
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
      accessPolicy: model.accessPolicy || undefined,
      temperature: model.temperature ?? null,
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
        const accessPolicy = (item as any)?.accessPolicy || (item as any)?.access_policy
        await updateModelCapabilities(Number(item.connectionId), String(item.rawId), {
          tags,
          capabilities: capPayload,
          accessPolicy,
          temperature: typeof item.temperature === 'number' ? item.temperature : null,
        })
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

  const toggleSelectAll = (keys?: string[]) => {
    const targetKeys = keys && keys.length > 0 ? keys : list.map((model: any) => keyOf(model))
    if (targetKeys.length === 0) return
    const allChecked = targetKeys.every((key) => selectedKeys.has(key))
    const next = new Set(selectedKeys)
    if (allChecked) targetKeys.forEach((key) => next.delete(key))
    else targetKeys.forEach((key) => next.add(key))
    setSelectedKeys(next)
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
    batchUpdating,
    bulkUpdateAccessPolicy,
    bulkUpdateCapability,
    clearDialogOpen,
    setClearDialogOpen,
    clearing,
    handleClearAll,
    handleExport,
    handleImportFile,
    handleToggleCapability,
    handleSaveMaxTokens,
    handleSaveContextWindow,
    handleSaveTemperature,
    handleUpdateAccessPolicy,
    resetModel,
    handleBatchReset,
    hasCapability,
    capabilityStateOf,
    recommendTag,
    accessOptions: ACCESS_OPTIONS,
  }
}
