import {
  contextWindowService,
  guessKnownContextWindow as guessKnownContextWindowService,
  guessKnownCompletionLimit as guessKnownCompletionLimitService,
} from '../services/context/context-window-service'

type Provider = 'openai' | 'azure_openai' | 'ollama' | 'google_genai' | string | null | undefined
export interface ResolveContextLimitOptions {
  connectionId?: number | null
  rawModelId?: string | null
  provider?: Provider
}

export const guessKnownContextWindow = (provider: Provider, rawId: string | null | undefined): number | null =>
  contextWindowService.guessKnownContextWindow(provider, rawId)

export const guessKnownCompletionLimit = (provider: Provider, rawId: string | null | undefined): number | null =>
  contextWindowService.guessKnownCompletionLimit(provider, rawId)

export const resolveContextLimit = (options: ResolveContextLimitOptions): Promise<number> =>
  contextWindowService.resolveContextLimit(options)

export const invalidateContextWindowCache = (connectionId?: number | null, rawModelId?: string | null) =>
  contextWindowService.invalidateContextWindowCache(connectionId, rawModelId)

export const resolveCompletionLimit = (options: ResolveContextLimitOptions): Promise<number> =>
  contextWindowService.resolveCompletionLimit(options)

export const invalidateCompletionLimitCache = (connectionId?: number | null, rawModelId?: string | null) =>
  contextWindowService.invalidateCompletionLimitCache(connectionId, rawModelId)
