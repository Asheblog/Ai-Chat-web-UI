import { useEffect, useMemo, useState } from 'react'

interface CustomHeader {
  name: string
  value: string
}

interface UseAdvancedRequestOptions {
  sessionId?: number | null
  storagePrefix?: string
}

const DEFAULT_STORAGE_PREFIX = 'aichat:custom-request:'

export const useAdvancedRequest = ({
  sessionId,
  storagePrefix = DEFAULT_STORAGE_PREFIX,
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

  return {
    cacheKey,
    customBodyInput,
    setCustomBodyInput,
    customBodyError,
    setCustomBodyError,
    customHeaders,
    setCustomHeaders,
  }
}
