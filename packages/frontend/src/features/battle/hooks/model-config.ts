import type { ModelItem } from '@/store/models-store'
import type { BattleContent, BattleUploadImage } from '@/types'
import { modelKeyFor } from '../utils/model-key'
import type {
  BattleDraftImage,
  BattleNodeModel,
  BattleRunConfigModel,
  ModelConfigState,
  ReasoningDefaults,
} from './types'

export const isVisionCapable = (model: ModelItem | null | undefined) => {
  return model?.capabilities?.vision === true
}

export const hasBattleContent = (text: string, images: BattleDraftImage[]) => {
  return text.trim().length > 0 || images.length > 0
}

export const toBattleUploadImages = (images: BattleDraftImage[]): BattleUploadImage[] => {
  return images
    .map((item) => {
      const data = typeof item.dataUrl === 'string' ? item.dataUrl.split(',')[1] || '' : ''
      const mime = typeof item.mime === 'string' ? item.mime.trim() : ''
      return { data, mime }
    })
    .filter((item) => item.data.length > 0 && item.mime.length > 0)
}

export const isPlaceholderModel = (model: ModelItem) =>
  model.provider === 'unknown' || model.channelName === 'unknown' || model.connectionId === 0

export const resolveModelFromCatalog = (
  catalog: ModelItem[] | undefined,
  ref: { modelId: string; connectionId?: number | null; rawId?: string | null },
) => {
  if (!catalog || catalog.length === 0) return null
  if (ref.connectionId != null && ref.rawId) {
    return catalog.find((item) => item.connectionId === ref.connectionId && item.rawId === ref.rawId) || null
  }
  return catalog.find((item) => item.id === ref.modelId) || null
}

export const buildPlaceholderModel = (ref: { modelId: string; connectionId?: number | null; rawId?: string | null }): ModelItem => {
  const rawId = ref.rawId || ref.modelId
  return {
    id: ref.modelId,
    rawId,
    name: rawId,
    provider: 'unknown',
    channelName: 'unknown',
    connectionBaseUrl: '',
    connectionId: ref.connectionId ?? 0,
  }
}

export const buildConfigState = (model: ModelItem, defaults?: ReasoningDefaults): ModelConfigState => ({
  key: modelKeyFor(model),
  model,
  webSearchEnabled: false,
  pythonEnabled: false,
  reasoningEnabled: defaults?.reasoningEnabled ?? false,
  reasoningEffort: defaults?.reasoningEffort ?? 'medium',
  extraPrompt: '',
  customBody: '',
  customHeaders: [],
  customBodyError: null,
  advancedOpen: false,
})

export const normalizeReasoningEffort = (value: unknown): 'low' | 'medium' | 'high' | 'max' | 'xhigh' | null => {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'max' || value === 'xhigh') {
    return value
  }
  return null
}

export const normalizeCustomHeaders = (headers?: Array<{ name?: string | null; value?: string | null }>) => {
  if (!Array.isArray(headers)) return []
  return headers
    .map((item) => ({
      name: String(item?.name || '').trim(),
      value: String(item?.value || '').trim(),
    }))
    .filter((item) => item.name.length > 0)
}

export const normalizeCustomBodyDraft = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return ''
}

export const buildConfigStateFromConfig = (
  model: ModelItem,
  defaults: ReasoningDefaults,
  config?: BattleRunConfigModel,
): ModelConfigState => {
  const base = buildConfigState(model, defaults)
  const customHeaders = normalizeCustomHeaders(config?.customHeaders)
  const customBody = normalizeCustomBodyDraft(config?.customBody)
  const extraPrompt = typeof config?.extraPrompt === 'string' ? config.extraPrompt : ''
  const reasoningEnabled =
    typeof config?.reasoningEnabled === 'boolean' ? config.reasoningEnabled : base.reasoningEnabled
  const reasoningEffort = normalizeReasoningEffort(config?.reasoningEffort) || base.reasoningEffort
  const advancedOpen = customHeaders.length > 0 || customBody.trim().length > 0 || extraPrompt.trim().length > 0
  return {
    ...base,
    webSearchEnabled: Boolean(config?.skills?.builtin?.includes('web-search')),
    pythonEnabled: Boolean(config?.skills?.builtin?.includes('python-runner')),
    reasoningEnabled,
    reasoningEffort,
    extraPrompt,
    customBody,
    customHeaders,
    advancedOpen,
  }
}

export const resolveNodeLabel = (model: BattleNodeModel, catalog?: ModelItem[]) => {
  const explicit = (model.label || '').trim()
  if (explicit) return explicit
  const matched = catalog?.find((item) => {
    if (model.connectionId != null && model.rawId) {
      return item.connectionId === model.connectionId && item.rawId === model.rawId
    }
    return item.id === model.modelId
  })
  return matched?.name || model.rawId || model.modelId
}

export const normalizeBattleContent = (raw: unknown): BattleContent => {
  if (!raw || typeof raw !== 'object') {
    return { text: '', images: [] }
  }
  const payload = raw as { text?: unknown; images?: unknown }
  const text = typeof payload.text === 'string' ? payload.text : ''
  const images = Array.isArray(payload.images)
    ? payload.images
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
    : []
  return { text, images }
}
