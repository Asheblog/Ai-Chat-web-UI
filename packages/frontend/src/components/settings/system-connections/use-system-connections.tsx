"use client"

import { useCallback, useEffect, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import type {
  SystemConnectionGroup,
  VerifyConnectionResult,
} from "@/services/system-connections"
import {
  createSystemConnection,
  updateSystemConnection,
  deleteSystemConnection,
  verifySystemConnection,
  fetchSystemConnections,
} from "@/services/system-connections"
import {
  createEmptyConnectionCaps,
  parseConnectionCaps,
  SPECIAL_PROVIDER_DEEPSEEK,
  SPECIAL_VENDOR_DEEPSEEK,
  type ConnectionCapKey,
} from "./constants"
import {
  buildPayload,
  createEmptyKey,
  createFormFromGroup,
  DEFAULT_FORM,
  validateForm,
  type ConnectionFormState,
  type ConnectionKeyFormState,
} from "./form-state"

export { SPECIAL_PROVIDER_DEEPSEEK, SPECIAL_VENDOR_DEEPSEEK }
export type { ConnectionFormState, ConnectionKeyFormState } from "./form-state"

export function useSystemConnections() {
  const { toast } = useToast()
  const [connections, setConnections] = useState<SystemConnectionGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SystemConnectionGroup | null>(null)
  const [form, setForm] = useState<ConnectionFormState>(DEFAULT_FORM)
  const [capabilities, setCapabilities] = useState<Record<ConnectionCapKey, boolean>>(createEmptyConnectionCaps())
  const [verifyResult, setVerifyResult] = useState<VerifyConnectionResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchSystemConnections()
      setConnections(list)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const resetForm = useCallback(() => {
    setForm({
      ...DEFAULT_FORM,
      keys: [createEmptyKey(0)],
    })
    setCapabilities(createEmptyConnectionCaps())
    setVerifyResult(null)
  }, [])

  const startEdit = useCallback((group: SystemConnectionGroup) => {
    setEditing(group)
    setForm(createFormFromGroup(group))
    setCapabilities(parseConnectionCaps(group.defaultCapabilities))
    setVerifyResult(null)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditing(null)
    resetForm()
  }, [resetForm])

  const addKey = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      keys: [...prev.keys, createEmptyKey(prev.keys.length)],
    }))
  }, [])

  const removeKey = useCallback((clientId: string) => {
    setForm((prev) => {
      const nextKeys = prev.keys.filter((item) => item.clientId !== clientId)
      return {
        ...prev,
        keys: nextKeys.length > 0 ? nextKeys : [createEmptyKey(0)],
      }
    })
  }, [])

  const updateKey = useCallback(
    (clientId: string, updater: (current: ConnectionKeyFormState) => ConnectionKeyFormState) => {
      setForm((prev) => ({
        ...prev,
        keys: prev.keys.map((item) => (item.clientId === clientId ? updater(item) : item)),
      }))
    },
    [],
  )

  const submitConnection = useCallback(async () => {
    const validationError = validateForm(form, editing)
    if (validationError) {
      toast({
        title: "表单未完成",
        description: validationError,
        variant: "destructive",
      })
      return false
    }

    const payload = buildPayload(form, capabilities)
    setSubmitting(true)
    try {
      if (editing) {
        await updateSystemConnection(editing.id, payload)
        toast({ title: "端点已更新", description: "共享配置和 Key 池都已保存。" })
      } else {
        await createSystemConnection(payload)
        toast({ title: "端点已创建", description: `已新增 ${payload.apiKeys.length} 个 Key 条目。` })
      }
      setEditing(null)
      resetForm()
      await load()
      return true
    } catch (err: any) {
      toast({
        title: "保存失败",
        description: err?.response?.data?.error || err?.message || "无法保存连接配置",
        variant: "destructive",
      })
      return false
    } finally {
      setSubmitting(false)
    }
  }, [capabilities, editing, form, load, resetForm, toast])

  const verifyConnection = useCallback(async () => {
    const validationError = validateForm(form, editing)
    if (validationError) {
      toast({
        title: "无法验证",
        description: validationError,
        variant: "destructive",
      })
      return false
    }

    const payload = buildPayload(form, capabilities)
    setVerifying(true)
    try {
      const res = await verifySystemConnection(payload)
      const result = (res?.data ?? null) as VerifyConnectionResult | null
      setVerifyResult(result)
      toast({
        title: "验证完成",
        description: `成功 ${result?.successCount ?? 0} 个，失败 ${result?.failureCount ?? 0} 个。`,
      })
      return true
    } catch (err: any) {
      toast({
        title: "验证失败",
        description: err?.response?.data?.error || err?.message || "无法完成验证",
        variant: "destructive",
      })
      return false
    } finally {
      setVerifying(false)
    }
  }, [capabilities, editing, form, toast])

  const removeConnection = useCallback(
    async (id: number) => {
      setDeletingId(id)
      try {
        await deleteSystemConnection(id)
        toast({ title: "端点已删除" })
        if (editing?.id === id) {
          setEditing(null)
          resetForm()
        }
        await load()
      } catch (err: any) {
        toast({
          title: "删除失败",
          description: err?.response?.data?.error || err?.message || "操作失败",
          variant: "destructive",
        })
      } finally {
        setDeletingId(null)
      }
    },
    [editing?.id, load, resetForm, toast],
  )

  const toggleCapability = useCallback((key: ConnectionCapKey, value: boolean) => {
    setCapabilities((prev) => ({
      ...prev,
      [key]: value,
    }))
  }, [])

  return {
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
    refresh: load,
    startEdit,
    cancelEdit,
    addKey,
    removeKey,
    updateKey,
    submitConnection,
    verifyConnection,
    removeConnection,
    toggleCapability,
  }
}
