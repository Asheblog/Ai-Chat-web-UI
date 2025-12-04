import { useCallback, useEffect, useMemo, useState } from 'react'

interface CustomHeader {
  name: string
  value: string
}

interface SanitizedHeader {
  name: string
  value: string
}

interface UseAdvancedRequestOptions {
  sessionId?: number | null
  storagePrefix?: string
  maxHeaders?: number
}

interface AddHeaderResult {
  ok: boolean
  reason?: string
}

interface SanitizeHeadersSuccess {
  ok: true
  sanitized: SanitizedHeader[]
}

interface SanitizeHeadersFailure {
  ok: false
  reason: string
}

export type BuildPayloadResultSuccess = {
  ok: true
  customBody?: Record<string, any>
  customHeaders?: SanitizedHeader[]
}

export type BuildPayloadResultFailure = {
  ok: false
  reason: string
}

export type BuildPayloadResult = BuildPayloadResultSuccess | BuildPayloadResultFailure

const DEFAULT_STORAGE_PREFIX = 'aichat:custom-request:'
const DEFAULT_MAX_HEADERS = 10
const MAX_HEADER_NAME_LENGTH = 64
const MAX_HEADER_VALUE_LENGTH = 2048

const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'connection',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
])

export const useAdvancedRequest = ({
  sessionId,
  storagePrefix = DEFAULT_STORAGE_PREFIX,
  maxHeaders = DEFAULT_MAX_HEADERS,
}: UseAdvancedRequestOptions) => {
  const cacheKey = useMemo(() => {
    if (!sessionId) return null
    return `${storagePrefix}${sessionId}`
  }, [sessionId, storagePrefix])

  const [customBodyInput, setCustomBodyInput] = useState('')
  const [customBodyError, setCustomBodyError] = useState<string | null>(null)
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([])

  useEffect(() => {
    if (!cacheKey) {
      setCustomBodyInput('')
      setCustomHeaders([])
      return
    }
    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) {
        setCustomBodyInput('')
        setCustomHeaders([])
        return
      }
      const parsed = JSON.parse(raw) as { body?: string; headers?: CustomHeader[] }
      setCustomBodyInput(typeof parsed?.body === 'string' ? parsed.body : '')
      if (Array.isArray(parsed?.headers)) {
        const sanitized = parsed.headers
          .filter((item) => item && typeof item.name === 'string' && typeof item.value === 'string')
          .map((item) => ({ name: item.name, value: item.value }))
        setCustomHeaders(sanitized)
      } else {
        setCustomHeaders([])
      }
    } catch {
      setCustomBodyInput('')
      setCustomHeaders([])
    }
  }, [cacheKey])

  useEffect(() => {
    if (!cacheKey) return
    try {
      const payload = JSON.stringify({ body: customBodyInput, headers: customHeaders })
      localStorage.setItem(cacheKey, payload)
    } catch {
      // ignore storage errors
    }
  }, [cacheKey, customBodyInput, customHeaders])

  const canAddHeader = customHeaders.length < maxHeaders

  const addCustomHeader = useCallback((): AddHeaderResult => {
    if (!canAddHeader) {
      return { ok: false, reason: '最多添加 ' + maxHeaders + ' 个请求头' }
    }
    setCustomHeaders((prev) => [...prev, { name: '', value: '' }])
    return { ok: true }
  }, [canAddHeader, maxHeaders])

  const updateCustomHeader = useCallback((index: number, field: 'name' | 'value', value: string) => {
    setCustomHeaders((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }, [])

  const removeCustomHeader = useCallback((index: number) => {
    setCustomHeaders((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const sanitizeHeaders = useCallback((): SanitizeHeadersSuccess | SanitizeHeadersFailure => {
    const sanitized: SanitizedHeader[] = []
    for (const item of customHeaders) {
      const name = (item?.name || '').trim()
      const value = (item?.value || '').trim()
      if (!name && !value) continue
      if (!name) {
        return { ok: false, reason: '请输入请求头名称' }
      }
      if (name.length > MAX_HEADER_NAME_LENGTH) {
        return { ok: false, reason: '请求头名称需 ≤ ' + MAX_HEADER_NAME_LENGTH + ' 字符' }
      }
      if (value.length > MAX_HEADER_VALUE_LENGTH) {
        return { ok: false, reason: '请求头值需 ≤ ' + MAX_HEADER_VALUE_LENGTH + ' 字符' }
      }
      const lower = name.toLowerCase()
      if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
        return { ok: false, reason: '敏感或受保护的请求头无法覆盖，请更换名称' }
      }
      const existingIdx = sanitized.findIndex((header) => header.name.toLowerCase() === lower)
      if (existingIdx >= 0) sanitized.splice(existingIdx, 1)
      if (!value) continue
      sanitized.push({ name, value })
    }
    return { ok: true, sanitized }
  }, [customHeaders])

  const buildRequestPayload = useCallback((): BuildPayloadResult => {
    const trimmedBody = customBodyInput.trim()
    let parsedBody: Record<string, any> | undefined
    if (trimmedBody) {
      try {
        const parsed = JSON.parse(trimmedBody)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('自定义请求体必须是 JSON 对象')
        }
        parsedBody = parsed
        setCustomBodyError(null)
      } catch (error: any) {
        const message = error instanceof Error ? error.message : '自定义请求体解析失败'
        setCustomBodyError(message)
        return { ok: false, reason: message }
      }
    } else {
      setCustomBodyError(null)
    }

    const headerResult = sanitizeHeaders()
    if (!headerResult.ok) {
      return { ok: false, reason: headerResult.reason }
    }

    return {
      ok: true,
      customBody: parsedBody,
      customHeaders: headerResult.sanitized.length ? headerResult.sanitized : undefined,
    }
  }, [customBodyInput, sanitizeHeaders])

  return {
    cacheKey,
    customBodyInput,
    setCustomBodyInput,
    customBodyError,
    setCustomBodyError,
    customHeaders,
    addCustomHeader,
    updateCustomHeader,
    removeCustomHeader,
    setCustomHeaders,
    canAddHeader,
    maxHeaders,
    buildRequestPayload,
  }
}
