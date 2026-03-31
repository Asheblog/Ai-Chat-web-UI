"use client"

import { useCallback, useEffect, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import type {
  SystemConnectionGroup,
  SystemConnectionPayload,
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
  type ConnectionCapKey,
} from "./constants"

export const SPECIAL_PROVIDER_DEEPSEEK = "deepseek_interleave"
export const SPECIAL_VENDOR_DEEPSEEK = "deepseek"

export interface ConnectionKeyFormState {
  clientId: string
  id?: number
  apiKeyLabel: string
  apiKey: string
  apiKeyMasked: string
  hasStoredApiKey: boolean
  modelIds: string
  enable: boolean
}

export interface ConnectionFormState {
  provider: string
  baseUrl: string
  authType: string
  azureApiVersion: string
  prefixId: string
  tags: string
  connectionType: string
  keys: ConnectionKeyFormState[]
}

const createDraftId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `key-${Math.random().toString(36).slice(2, 10)}`
}

const createEmptyKey = (index = 0): ConnectionKeyFormState => ({
  clientId: createDraftId(),
  apiKeyLabel: `Key ${index + 1}`,
  apiKey: "",
  apiKeyMasked: "",
  hasStoredApiKey: false,
  modelIds: "",
  enable: true,
})

const DEFAULT_FORM: ConnectionFormState = {
  provider: "openai",
  baseUrl: "",
  authType: "bearer",
  azureApiVersion: "",
  prefixId: "",
  tags: "",
  connectionType: "external",
  keys: [createEmptyKey(0)],
}

const buildTags = (raw: string) => {
  if (!raw.trim()) return []
  return raw
    .split(",")
    .map((name) => ({ name: name.trim() }))
    .filter((item) => item.name)
}

const buildModelIds = (raw: string) => {
  if (!raw.trim()) return []
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const mapProviderSelection = (value: string): Pick<SystemConnectionPayload, "provider" | "vendor"> => {
  if (value === SPECIAL_PROVIDER_DEEPSEEK) {
    return { provider: "openai", vendor: SPECIAL_VENDOR_DEEPSEEK }
  }
  return { provider: value, vendor: undefined }
}

const buildPayload = (
  form: ConnectionFormState,
  capabilities: Record<ConnectionCapKey, boolean>,
): SystemConnectionPayload => {
  const { provider, vendor } = mapProviderSelection(form.provider)
  return {
    provider,
    ...(vendor ? { vendor } : {}),
    baseUrl: form.baseUrl.trim(),
    authType: form.authType,
    azureApiVersion: form.azureApiVersion.trim() || undefined,
    prefixId: form.prefixId.trim() || undefined,
    tags: buildTags(form.tags),
    connectionType: form.connectionType,
    defaultCapabilities: capabilities,
    apiKeys: form.keys.map((key) => ({
      ...(key.id ? { id: key.id } : {}),
      apiKeyLabel: key.apiKeyLabel.trim() || undefined,
      apiKey: key.apiKey.trim() || undefined,
      modelIds: buildModelIds(key.modelIds),
      enable: key.enable,
    })),
  }
}

const createFormFromGroup = (group: SystemConnectionGroup): ConnectionFormState => {
  const providerSelection =
    group.vendor === SPECIAL_VENDOR_DEEPSEEK ? SPECIAL_PROVIDER_DEEPSEEK : group.provider || "openai"

  return {
    provider: providerSelection,
    baseUrl: group.baseUrl || "",
    authType: group.authType || "bearer",
    azureApiVersion: group.azureApiVersion || "",
    prefixId: group.prefixId || "",
    tags: (group.tags || []).map((item) => item?.name).filter(Boolean).join(","),
    connectionType: group.connectionType || "external",
    keys:
      group.apiKeys?.length > 0
        ? group.apiKeys.map((item, index) => ({
            clientId: String(item.id || createDraftId()),
            id: item.id,
            apiKeyLabel: item.apiKeyLabel || `Key ${index + 1}`,
            apiKey: "",
            apiKeyMasked: item.apiKeyMasked || "",
            hasStoredApiKey: Boolean(item.hasStoredApiKey),
            modelIds: (item.modelIds || []).join(",\n"),
            enable: item.enable ?? true,
          }))
        : [createEmptyKey(0)],
  }
}

const validateForm = (form: ConnectionFormState, editing: SystemConnectionGroup | null) => {
  if (!form.baseUrl.trim()) return "请填写 Base URL"
  if (form.keys.length === 0) return "至少需要一个 API Key 条目"

  for (let index = 0; index < form.keys.length; index += 1) {
    const key = form.keys[index]
    const label = key.apiKeyLabel.trim() || `Key ${index + 1}`
    if (form.authType === "bearer" && !key.apiKey.trim() && !key.hasStoredApiKey) {
      return `${label} 还没有可用的 API Key`
    }
    if (editing && key.id && !editing.apiKeys.some((item) => item.id === key.id)) {
      return `${label} 的条目状态已过期，请刷新后重试`
    }
  }

  return null
}

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
      return
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
    } catch (err: any) {
      toast({
        title: "保存失败",
        description: err?.response?.data?.error || err?.message || "无法保存连接配置",
        variant: "destructive",
      })
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
      return
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
    } catch (err: any) {
      toast({
        title: "验证失败",
        description: err?.response?.data?.error || err?.message || "无法完成验证",
        variant: "destructive",
      })
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
