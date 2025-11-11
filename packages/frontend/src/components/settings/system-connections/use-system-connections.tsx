"use client"
import { useCallback, useEffect, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import type { SystemConnection, SystemConnectionPayload } from "@/services/system-connections"
import {
  createSystemConnection,
  updateSystemConnection,
  deleteSystemConnection,
  verifySystemConnection,
  fetchSystemConnections,
} from "@/services/system-connections"
import {
  CONNECTION_CAP_KEYS,
  type ConnectionCapKey,
  createEmptyConnectionCaps,
  parseConnectionCaps,
} from "./constants"

export interface ConnectionFormState {
  provider: string
  baseUrl: string
  authType: string
  apiKey: string
  azureApiVersion: string
  enable: boolean
  prefixId: string
  tags: string
  modelIds: string
  connectionType: string
}

const DEFAULT_FORM: ConnectionFormState = {
  provider: 'openai',
  baseUrl: '',
  authType: 'bearer',
  apiKey: '',
  azureApiVersion: '',
  enable: true,
  prefixId: '',
  tags: '',
  modelIds: '',
  connectionType: 'external',
}

const buildTags = (raw: string) => {
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map((name) => ({ name: name.trim() }))
    .filter((item) => item.name)
}

const buildPayload = (form: ConnectionFormState, capabilities: Record<ConnectionCapKey, boolean>): SystemConnectionPayload => ({
  provider: form.provider,
  baseUrl: form.baseUrl,
  authType: form.authType,
  apiKey: form.apiKey || undefined,
  azureApiVersion: form.azureApiVersion || undefined,
  enable: !!form.enable,
  prefixId: form.prefixId || undefined,
  tags: buildTags(form.tags),
  modelIds: form.modelIds
    ? form.modelIds.split(',').map((id) => id.trim()).filter(Boolean)
    : [],
  connectionType: form.connectionType,
  defaultCapabilities: capabilities,
})

const extractTags = (row: SystemConnection) => {
  try {
    const parsed = JSON.parse(row.tagsJson || '[]')
    if (!Array.isArray(parsed)) return ''
    const rows = parsed
      .map((item: any) => item?.name)
      .filter((name: string) => name && !CONNECTION_CAP_KEYS.includes(name as ConnectionCapKey))
    return rows.join(',')
  } catch {
    return ''
  }
}

const extractModelIds = (row: SystemConnection) => {
  try {
    const parsed = JSON.parse(row.modelIdsJson || '[]')
    if (!Array.isArray(parsed)) return ''
    return parsed.join(',')
  } catch {
    return ''
  }
}

export function useSystemConnections() {
  const { toast } = useToast()
  const [connections, setConnections] = useState<SystemConnection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SystemConnection | null>(null)
  const [form, setForm] = useState<ConnectionFormState>(DEFAULT_FORM)
  const [capabilities, setCapabilities] = useState<Record<ConnectionCapKey, boolean>>(createEmptyConnectionCaps())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchSystemConnections()
      setConnections(list)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const resetForm = useCallback(() => {
    setForm(DEFAULT_FORM)
    setCapabilities(createEmptyConnectionCaps())
  }, [])

  const startEdit = (row: SystemConnection) => {
    setEditing(row)
    setForm({
      provider: row.provider || 'openai',
      baseUrl: row.baseUrl || '',
      authType: row.authType || 'bearer',
      apiKey: '',
      azureApiVersion: row.azureApiVersion || '',
      enable: !!row.enable,
      prefixId: row.prefixId || '',
      tags: extractTags(row),
      modelIds: extractModelIds(row),
      connectionType: row.connectionType || 'external',
    })
    setCapabilities(parseConnectionCaps(row.defaultCapabilitiesJson))
  }

  const cancelEdit = () => {
    setEditing(null)
    resetForm()
  }

  const submitConnection = async () => {
    const payload = buildPayload(form, capabilities)
    try {
      if (editing) {
        await updateSystemConnection(editing.id, payload)
        toast({ title: '连接已更新' })
      } else {
        await createSystemConnection(payload)
        toast({ title: '连接已创建' })
      }
      setEditing(null)
      resetForm()
      await load()
    } catch (err: any) {
      toast({
        title: '保存失败',
        description: err?.response?.data?.error || err?.message || '无法保存连接配置',
        variant: 'destructive',
      })
    }
  }

  const verifyConnection = async () => {
    const payload = buildPayload(form, capabilities)
    try {
      await verifySystemConnection(payload)
      toast({ title: '验证成功', description: '连接可用，配置已通过测试。' })
    } catch (err: any) {
      toast({
        title: '验证失败',
        description: err?.response?.data?.error || err?.message || '无法完成验证',
        variant: 'destructive',
      })
    }
  }

  const removeConnection = async (id: number) => {
    try {
      await deleteSystemConnection(id)
      toast({ title: '已删除连接' })
      await load()
    } catch (err: any) {
      toast({
        title: '删除失败',
        description: err?.response?.data?.error || err?.message || '操作失败',
        variant: 'destructive',
      })
    }
  }

  const toggleCapability = (key: ConnectionCapKey, value: boolean) => {
    setCapabilities((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  return {
    connections,
    loading,
    error,
    form,
    setForm,
    capabilities,
    editing,
    refresh: load,
    startEdit,
    cancelEdit,
    submitConnection,
    verifyConnection,
    removeConnection,
    toggleCapability,
  }
}
