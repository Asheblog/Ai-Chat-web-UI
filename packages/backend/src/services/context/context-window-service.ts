import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  getReasoningMaxOutputTokensDefault as defaultGetReasoningMaxOutputTokensDefault,
  getSystemContextTokenLimit as defaultGetSystemContextTokenLimit,
} from '../../utils/system-settings'

type Provider = 'openai' | 'azure_openai' | 'ollama' | 'google_genai' | string | null | undefined

type CacheKey = `${number | 'none'}:${string | 'none'}`

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

const KNOWN_COMPLETION_LIMITS: Array<{ provider?: Provider; match: RegExp; tokens: number }> = []

const coercePositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
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

export interface ContextWindowServiceDeps {
  prisma?: PrismaClient
  getReasoningMaxOutputTokensDefault?: typeof defaultGetReasoningMaxOutputTokensDefault
  getSystemContextTokenLimit?: typeof defaultGetSystemContextTokenLimit
  cacheTtlMs?: number
  now?: () => number
}

export class ContextWindowService {
  private prisma: PrismaClient
  private getReasoningMaxOutputTokensDefault: typeof defaultGetReasoningMaxOutputTokensDefault
  private getSystemContextTokenLimit: typeof defaultGetSystemContextTokenLimit
  private cacheTtlMs: number
  private now: () => number
  private contextCache = new Map<CacheKey, { value: number; expiresAt: number }>()
  private completionCache = new Map<CacheKey, { value: number; expiresAt: number }>()

  constructor(deps: ContextWindowServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.getReasoningMaxOutputTokensDefault =
      deps.getReasoningMaxOutputTokensDefault ?? defaultGetReasoningMaxOutputTokensDefault
    this.getSystemContextTokenLimit = deps.getSystemContextTokenLimit ?? defaultGetSystemContextTokenLimit
    this.cacheTtlMs = deps.cacheTtlMs ?? 5 * 60 * 1000
    this.now = deps.now ?? (() => Date.now())
  }

  guessKnownContextWindow(provider: Provider, rawId: string | null | undefined): number | null {
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

  guessKnownCompletionLimit(provider: Provider, rawId: string | null | undefined): number | null {
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

  async resolveContextLimit(options: { connectionId?: number | null; rawModelId?: string | null; provider?: Provider }) {
    const connectionId = options.connectionId ?? null
    const rawId = options.rawModelId ?? null
    const provider = options.provider ?? null
    const cacheKey: CacheKey = `${connectionId ?? 'none'}:${rawId ?? 'none'}`
    const now = this.now()
    const cached = this.contextCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }

    let contextWindow = 0

    if (connectionId !== null && rawId) {
      const catalog = await this.prisma.modelCatalog.findFirst({
        where: { connectionId, rawId },
        select: { metaJson: true },
      })
      contextWindow = coercePositive(parseMetaContextWindow(catalog?.metaJson) ?? 0)
    }

    if (!contextWindow && rawId) {
      const guessed = this.guessKnownContextWindow(provider, rawId)
      if (guessed) {
        contextWindow = guessed
      }
    }

    if (!contextWindow) {
      const fallback = await this.getSystemContextTokenLimit()
      contextWindow = coercePositive(fallback)
    }

    if (!contextWindow) {
      throw new Error('Context window is not configured for the selected model')
    }

    this.contextCache.set(cacheKey, { value: contextWindow, expiresAt: now + this.cacheTtlMs })
    return contextWindow
  }

  invalidateContextWindowCache(connectionId?: number | null, rawModelId?: string | null) {
    if (connectionId === undefined && rawModelId === undefined) {
      this.contextCache.clear()
      return
    }
    const key: CacheKey = `${connectionId ?? 'none'}:${rawModelId ?? 'none'}`
    this.contextCache.delete(key)
  }

  async resolveCompletionLimit(options: { connectionId?: number | null; rawModelId?: string | null; provider?: Provider }) {
    const connectionId = options.connectionId ?? null
    const rawId = options.rawModelId ?? null
    const provider = options.provider ?? null
    const cacheKey: CacheKey = `${connectionId ?? 'none'}:${rawId ?? 'none'}`
    const now = this.now()
    const cached = this.completionCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }

    let completionLimit = 0

    if (connectionId !== null && rawId) {
      const catalog = await this.prisma.modelCatalog.findFirst({
        where: { connectionId, rawId },
        select: { metaJson: true },
      })
      completionLimit = coercePositive(parseMetaCompletionLimit(catalog?.metaJson) ?? 0)
    }

    if (!completionLimit) {
      const guessed = this.guessKnownCompletionLimit(provider, rawId)
      if (guessed) {
        completionLimit = guessed
      }
    }

    if (!completionLimit) {
      completionLimit = await this.getReasoningMaxOutputTokensDefault()
      completionLimit = coercePositive(completionLimit)
    }

    if (!completionLimit) {
      completionLimit = 1
    }

    this.completionCache.set(cacheKey, { value: completionLimit, expiresAt: now + this.cacheTtlMs })
    return completionLimit
  }

  invalidateCompletionLimitCache(connectionId?: number | null, rawModelId?: string | null) {
    if (connectionId === undefined && rawModelId === undefined) {
      this.completionCache.clear()
      return
    }
    const key: CacheKey = `${connectionId ?? 'none'}:${rawModelId ?? 'none'}`
    this.completionCache.delete(key)
  }
}

let contextWindowService = new ContextWindowService()

export const setContextWindowService = (service: ContextWindowService) => {
  contextWindowService = service
}

export { contextWindowService }
