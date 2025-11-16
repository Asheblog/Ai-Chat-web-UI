import { prisma } from '../db'
import { getReasoningMaxOutputTokensDefault, getSystemContextTokenLimit } from './system-settings'

type Provider = 'openai' | 'azure_openai' | 'ollama' | 'google_genai' | string | null | undefined

const CACHE_TTL_MS = 5 * 60 * 1000

type CacheKey = `${number | 'none'}:${string | 'none'}`

const contextCache = new Map<CacheKey, { value: number; expiresAt: number }>()
const completionCache = new Map<CacheKey, { value: number; expiresAt: number }>()

const KNOWN_OPENAI_CONTEXT_WINDOWS: Array<{ match: RegExp; tokens: number }> = [
  { match: /^gpt-4o-mini(-.*)?$/i, tokens: 64_000 },
  { match: /^gpt-4o(-.*)?$/i, tokens: 128_000 },
  { match: /^gpt-4.1-mini(-.*)?$/i, tokens: 64_000 },
  { match: /^gpt-4.1(-.*)?$/i, tokens: 128_000 },
  { match: /^gpt-4-turbo(-.*)?$/i, tokens: 128_000 },
  { match: /^gpt-4(-.*)?$/i, tokens: 8_192 },
  { match: /^gpt-3.5-turbo(-.*)?$/i, tokens: 16_385 },
  { match: /^o1-mini(-.*)?$/i, tokens: 128_000 },
  { match: /^o1-preview(-.*)?$/i, tokens: 128_000 },
]

const KNOWN_GOOGLE_CONTEXT_WINDOWS: Array<{ match: RegExp; tokens: number }> = [
  { match: /^gemini-1\.5-pro(-.*)?$/i, tokens: 1_000_000 },
  { match: /^gemini-1\.5-flash(-.*)?$/i, tokens: 1_000_000 },
]

const KNOWN_COMPLETION_LIMITS: Array<{ provider?: Provider; match: RegExp; tokens: number }> = [
  // DeepSeek chat 接口官方建议 4K 输出
  { provider: 'openai', match: /^deepseek-chat(-.*)?$/i, tokens: 4_096 },
  // Reasoner/推理模型默认 32K（与系统设置保持一致，但仍提供显式命中，防止被其它兜底覆盖）
  { provider: 'openai', match: /^deepseek-reasoner(-.*)?$/i, tokens: 32_000 },
]

export const guessKnownContextWindow = (provider: Provider, rawId: string | null | undefined): number | null => {
  if (!rawId) return null
  const target = rawId.toLowerCase()
  const rules = provider === 'google_genai' ? KNOWN_GOOGLE_CONTEXT_WINDOWS : KNOWN_OPENAI_CONTEXT_WINDOWS
  for (const item of rules) {
    if (item.match.test(target)) {
      return item.tokens
    }
  }
  return null
}

export const guessKnownCompletionLimit = (provider: Provider, rawId: string | null | undefined): number | null => {
  if (!rawId) return null
  const target = rawId.toLowerCase()
  for (const item of KNOWN_COMPLETION_LIMITS) {
    if (item.provider && provider && item.provider !== provider) continue
    if (item.match.test(target)) {
      return item.tokens
    }
  }
  return null
}

const parseMetaContextWindow = (metaJson: string | null | undefined): number | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const value = parsed?.context_window
    const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
    if (Number.isFinite(num) && num > 0) {
      return num
    }
  } catch {
    // ignore invalid metaJson
  }
  return null
}

const parseMetaCompletionLimit = (metaJson: string | null | undefined): number | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const candidates = [
      parsed?.custom_max_output_tokens,
      parsed?.max_output_tokens,
      parsed?.max_completion_tokens,
      parsed?.completion_limit,
    ]
    for (const candidate of candidates) {
      const num = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate ?? ''), 10)
      if (Number.isFinite(num) && num > 0) {
        return num
      }
    }
  } catch {
    // ignore invalid metaJson
  }
  return null
}

const coercePositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.floor(value)
}

export interface ResolveContextLimitOptions {
  connectionId?: number | null
  rawModelId?: string | null
  provider?: Provider
}

export const resolveContextLimit = async (options: ResolveContextLimitOptions): Promise<number> => {
  const connectionId = options.connectionId ?? null
  const rawId = options.rawModelId ?? null
  const provider = options.provider ?? null

  const cacheKey: CacheKey = `${connectionId ?? 'none'}:${rawId ?? 'none'}`
  const now = Date.now()
  const cached = contextCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  let contextWindow = 0

  if (connectionId !== null && rawId) {
    const catalog = await prisma.modelCatalog.findFirst({
      where: {
        connectionId,
        rawId,
      },
      select: {
        metaJson: true,
      },
    })
    contextWindow = coercePositive(parseMetaContextWindow(catalog?.metaJson) ?? 0)
  }

  if (!contextWindow && rawId) {
    const guessed = guessKnownContextWindow(provider, rawId)
    if (guessed) {
      contextWindow = guessed
    }
  }

  if (!contextWindow) {
    const fallback = await getSystemContextTokenLimit()
    contextWindow = coercePositive(fallback)
  }

  if (!contextWindow) {
    throw new Error('Context window is not configured for the selected model')
  }

  contextCache.set(cacheKey, { value: contextWindow, expiresAt: now + CACHE_TTL_MS })
  return contextWindow
}

export const invalidateContextWindowCache = (connectionId?: number | null, rawModelId?: string | null) => {
  if (connectionId === undefined && rawModelId === undefined) {
    contextCache.clear()
    return
  }
  const key: CacheKey = `${connectionId ?? 'none'}:${rawModelId ?? 'none'}`
  contextCache.delete(key)
}

export const resolveCompletionLimit = async (options: ResolveContextLimitOptions): Promise<number> => {
  const connectionId = options.connectionId ?? null
  const rawId = options.rawModelId ?? null
  const provider = options.provider ?? null
  const cacheKey: CacheKey = `${connectionId ?? 'none'}:${rawId ?? 'none'}`
  const now = Date.now()
  const cached = completionCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  let completionLimit = 0

  if (connectionId !== null && rawId) {
    const catalog = await prisma.modelCatalog.findFirst({
      where: {
        connectionId,
        rawId,
      },
      select: {
        metaJson: true,
      },
    })
    completionLimit = coercePositive(parseMetaCompletionLimit(catalog?.metaJson) ?? 0)
  }

  if (!completionLimit) {
    const guessed = guessKnownCompletionLimit(provider, rawId)
    if (guessed) {
      completionLimit = guessed
    }
  }

  if (!completionLimit) {
    completionLimit = await getReasoningMaxOutputTokensDefault()
    completionLimit = coercePositive(completionLimit)
  }

  if (!completionLimit) {
    // fallback：确保至少返回 1，避免上游出现 0 导致厂商拒绝
    completionLimit = 1
  }

  completionCache.set(cacheKey, { value: completionLimit, expiresAt: now + CACHE_TTL_MS })
  return completionLimit
}

export const invalidateCompletionLimitCache = (connectionId?: number | null, rawModelId?: string | null) => {
  if (connectionId === undefined && rawModelId === undefined) {
    completionCache.clear()
    return
  }
  const key: CacheKey = `${connectionId ?? 'none'}:${rawModelId ?? 'none'}`
  completionCache.delete(key)
}
