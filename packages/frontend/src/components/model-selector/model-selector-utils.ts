import { deriveChannelName } from "@/lib/utils"
import type { ModelItem } from "@/store/models-store"
import { modelKeyFor } from "@/store/model-preference-store"
import type { CapabilityFilter, SelectorView } from "./model-selector-types"
import { PRIORITY_GROUP_ORDER } from "./model-selector-types"

interface BuildModelCollectionsInput {
  allModels: ModelItem[]
  searchTerm: string
  selectorView: SelectorView
  capabilityFilter: CapabilityFilter
  recentModels: string[]
  favoriteModels: string[]
  selectedModelId: string | null
}

export interface ModelCollections {
  groupedModels: Record<string, ModelItem[]>
  quickModels: ModelItem[]
  visibleCount: number
  favoriteModelKeys: Set<string>
}

export const parseStoredModelIds = (value: string | null): string[] => {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

export const isModelSelected = (
  model: ModelItem,
  selectedModelId: string | null
): boolean => {
  if (!selectedModelId) {
    return false
  }

  return (
    selectedModelId === model.id ||
    selectedModelId === modelKeyFor(model) ||
    (model.rawId ? selectedModelId === model.rawId : false)
  )
}

export const matchesStoredModelId = (model: ModelItem, storedId: string): boolean => {
  return (
    model.id === storedId ||
    (model.rawId ? model.rawId === storedId : false) ||
    modelKeyFor(model) === storedId
  )
}

export const formatContextWindow = (tokens: number): string => {
  if (tokens < 1000) {
    return `${tokens}`
  }

  return `${Math.round(tokens / 1000)}k`
}

export const hasCapability = (model: ModelItem, capability: string): boolean => {
  return model.capabilities?.[capability as keyof typeof model.capabilities] === true
}

export const extractModelGroup = (model: ModelItem): string => {
  const name = model.name.toLowerCase()
  const id = model.id.toLowerCase()
  const combined = `${name} ${id}`

  const modelPatterns = [
    { pattern: /gpt-?4|gpt-?3\.?5|chatgpt|openai/i, group: "OpenAI" },
    { pattern: /claude|anthropic/i, group: "Anthropic" },
    { pattern: /llama|meta-llama/i, group: "Llama" },
    { pattern: /gemini|google|bard/i, group: "Google" },
    { pattern: /command-?r|cohere/i, group: "Cohere" },
    { pattern: /qwen|tongyi|通义/i, group: "Qwen" },
    { pattern: /deepseek/i, group: "DeepSeek" },
    { pattern: /mistral|mixtral/i, group: "Mistral" },
    { pattern: /yi-|零一万物/i, group: "01.AI" },
    { pattern: /moonshot|kimi|月之暗面/i, group: "Moonshot" },
    { pattern: /baichuan|百川/i, group: "Baichuan" },
    { pattern: /chatglm|智谱/i, group: "GLM" },
    { pattern: /ernie|文心/i, group: "ERNIE" },
    { pattern: /spark|讯飞/i, group: "iFlytek" },
    { pattern: /phi-?[0-9]/i, group: "Microsoft" },
    { pattern: /wizardlm|wizard/i, group: "WizardLM" },
    { pattern: /vicuna/i, group: "Vicuna" },
    { pattern: /falcon/i, group: "Falcon" },
    { pattern: /grok/i, group: "xAI" },
    { pattern: /minimax/i, group: "MiniMax" },
  ]

  for (const { pattern, group } of modelPatterns) {
    if (pattern.test(combined)) {
      return group
    }
  }

  const slashMatch = model.name.match(/^([^/]+)\//)
  if (slashMatch) {
    const org = slashMatch[1]
    if (!["LLM-Research", "meta-llama", "TheBloke", "NousResearch"].includes(org)) {
      return org
    }
  }

  const idSlashMatch = model.id.match(/^([^/]+)\//)
  if (idSlashMatch) {
    return idSlashMatch[1]
  }

  if (model.provider && model.provider !== "openai") {
    return `${model.provider.charAt(0).toUpperCase()}${model.provider.slice(1)}`
  }

  return "其他"
}

export const buildModelCollections = ({
  allModels,
  searchTerm,
  selectorView,
  capabilityFilter,
  recentModels,
  favoriteModels,
  selectedModelId,
}: BuildModelCollectionsInput): ModelCollections => {
  const findModelByStoredId = (storedId: string) => {
    return allModels.find((model) => matchesStoredModelId(model, storedId))
  }

  const recentList = recentModels
    .map(findModelByStoredId)
    .filter((model): model is ModelItem => model !== undefined)
  const favoriteList = favoriteModels
    .map(findModelByStoredId)
    .filter((model): model is ModelItem => model !== undefined)

  const recentKeySet = new Set(recentList.map((model) => modelKeyFor(model)))
  const favoriteKeySet = new Set(favoriteList.map((model) => modelKeyFor(model)))
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()

  const filtered = allModels.filter((model) => {
    const modelKey = modelKeyFor(model)

    if (selectorView === "favorites" && !favoriteKeySet.has(modelKey)) {
      return false
    }

    if (selectorView === "recent" && !recentKeySet.has(modelKey)) {
      return false
    }

    if (normalizedSearchTerm) {
      const channel = model.channelName || deriveChannelName(model.provider, model.connectionBaseUrl)
      const content = `${model.name} ${model.id} ${model.provider} ${channel}`.toLowerCase()
      if (!content.includes(normalizedSearchTerm)) {
        return false
      }
    }

    if (capabilityFilter !== "all" && !hasCapability(model, capabilityFilter)) {
      return false
    }

    return true
  })

  const groups: Record<string, ModelItem[]> = {}
  filtered.forEach((model) => {
    const groupName = extractModelGroup(model)
    if (!groups[groupName]) {
      groups[groupName] = []
    }
    groups[groupName].push(model)
  })

  const scoreModel = (model: ModelItem) => {
    const key = modelKeyFor(model)
    return (
      (isModelSelected(model, selectedModelId) ? 100 : 0) +
      (favoriteKeySet.has(key) ? 10 : 0) +
      (recentKeySet.has(key) ? 5 : 0)
    )
  }

  const sortModels = (models: ModelItem[]) => {
    return [...models].sort((a, b) => {
      const scoreDiff = scoreModel(b) - scoreModel(a)
      if (scoreDiff !== 0) {
        return scoreDiff
      }
      return a.name.localeCompare(b.name)
    })
  }

  const sortedGroups: Record<string, ModelItem[]> = {}
  PRIORITY_GROUP_ORDER.forEach((groupName) => {
    if (groups[groupName]) {
      sortedGroups[groupName] = sortModels(groups[groupName])
    }
  })

  Object.keys(groups)
    .filter((groupName) => !PRIORITY_GROUP_ORDER.includes(groupName as (typeof PRIORITY_GROUP_ORDER)[number]))
    .sort()
    .forEach((groupName) => {
      sortedGroups[groupName] = sortModels(groups[groupName])
    })

  const quickMap = new Map<string, ModelItem>()
  for (const model of [...recentList, ...favoriteList]) {
    const key = modelKeyFor(model)
    if (!quickMap.has(key)) {
      quickMap.set(key, model)
    }
  }

  return {
    groupedModels: sortedGroups,
    quickModels: Array.from(quickMap.values()).slice(0, 4),
    visibleCount: filtered.length,
    favoriteModelKeys: favoriteKeySet,
  }
}
