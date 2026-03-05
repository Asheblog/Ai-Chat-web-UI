import { ContextWindowService } from '../services/context/context-window-service'

type Provider = 'openai' | 'azure_openai' | 'ollama' | 'google_genai' | string | null | undefined
export interface ResolveContextLimitOptions {
  connectionId?: number | null
  rawModelId?: string | null
  provider?: Provider
}

interface ContextWindowUtilsDeps {
  contextWindowService: ContextWindowService
}

let configuredContextWindowService: ContextWindowService | null = null
let fallbackContextWindowService: ContextWindowService | null = null

const resolveContextWindowService = (): ContextWindowService => {
  if (configuredContextWindowService) return configuredContextWindowService
  if (!fallbackContextWindowService) {
    fallbackContextWindowService = new ContextWindowService()
  }
  return fallbackContextWindowService
}

export const configureContextWindowUtils = (deps: ContextWindowUtilsDeps): void => {
  configuredContextWindowService = deps.contextWindowService
}

export const guessKnownContextWindow = (provider: Provider, rawId: string | null | undefined): number | null =>
  resolveContextWindowService().guessKnownContextWindow(provider, rawId)

export const guessKnownCompletionLimit = (provider: Provider, rawId: string | null | undefined): number | null =>
  resolveContextWindowService().guessKnownCompletionLimit(provider, rawId)

export const resolveContextLimit = (options: ResolveContextLimitOptions): Promise<number> =>
  resolveContextWindowService().resolveContextLimit(options)

export const invalidateContextWindowCache = (connectionId?: number | null, rawModelId?: string | null) =>
  resolveContextWindowService().invalidateContextWindowCache(connectionId, rawModelId)

export const resolveCompletionLimit = (options: ResolveContextLimitOptions): Promise<number> =>
  resolveContextWindowService().resolveCompletionLimit(options)

export const invalidateCompletionLimitCache = (connectionId?: number | null, rawModelId?: string | null) =>
  resolveContextWindowService().invalidateCompletionLimitCache(connectionId, rawModelId)
