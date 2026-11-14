/**
 * 披露偏好：key 与旧实现完全一致，旧用户的记忆不会丢。
 *
 * - sessionStorage `aichat.cot_timeline_level:<scopeKey>` → { level, updatedAt }
 * - sessionStorage `aichat.cot_timeline_steps:<scopeKey>` → 数字
 * - localStorage `aichat.cot_reasoning_visibility` / `aichat.cot_tool_visibility`
 *   → { [itemKey]: { expanded, updatedAt } }，最多保留 200 条
 *
 * 级别语义沿用 shared：collapsed / outline / expanded。工作区把 outline 与 expanded
 * 都视为"打开"，collapsed 视为关闭，所以旧 outline 偏好会直接打开新工作区。
 */
import { isCotTimelineLevel, type CotTimelineLevel } from '@aichat/shared/cot-timeline-view'

export const COT_TIMELINE_LEVEL_STORAGE_PREFIX = 'aichat.cot_timeline_level'
export const COT_TIMELINE_STEPS_STORAGE_PREFIX = 'aichat.cot_timeline_steps'
export const REASONING_VISIBILITY_STORAGE_KEY = 'aichat.cot_reasoning_visibility'
export const TOOL_VISIBILITY_STORAGE_KEY = 'aichat.cot_tool_visibility'

const VISIBILITY_LIMIT = 200

const levelStorageKey = (scopeKey: string) =>
  scopeKey ? `${COT_TIMELINE_LEVEL_STORAGE_PREFIX}:${scopeKey}` : ''

const stepsStorageKey = (scopeKey: string) =>
  scopeKey ? `${COT_TIMELINE_STEPS_STORAGE_PREFIX}:${scopeKey}` : ''

const safeSession = (): Storage | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const safeLocal = (): Storage | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const readProcessLevel = (scopeKey: string): CotTimelineLevel | null => {
  const storage = safeSession()
  const key = levelStorageKey(scopeKey)
  if (!storage || !key) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { level?: unknown } | null
    return isCotTimelineLevel(parsed?.level) ? parsed.level : null
  } catch {
    return null
  }
}

export const persistProcessLevel = (scopeKey: string, level: CotTimelineLevel | null): void => {
  const storage = safeSession()
  const key = levelStorageKey(scopeKey)
  if (!storage || !key) return
  try {
    if (level == null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify({ level, updatedAt: Date.now() }))
  } catch {
    // 存储受限时退化为本次挂载的内存态，不阻断交互
  }
}

export const readProcessSteps = (scopeKey: string): number | null => {
  const storage = safeSession()
  const key = stepsStorageKey(scopeKey)
  if (!storage || !key) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = Number(raw)
    return Number.isSafeInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export const persistProcessSteps = (scopeKey: string, count: number): void => {
  const storage = safeSession()
  const key = stepsStorageKey(scopeKey)
  if (!storage || !key) return
  try {
    storage.setItem(key, String(count))
  } catch {
    // 同上
  }
}

interface VisibilityMap {
  [itemKey: string]: { expanded: boolean; updatedAt: number }
}

const readVisibilityMap = (storageKey: string): VisibilityMap => {
  const storage = safeLocal()
  if (!storage) return {}
  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as VisibilityMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const readProcessVisibility = (storageKey: string, itemKey: string): boolean | null => {
  if (!itemKey) return null
  const entry = readVisibilityMap(storageKey)[itemKey]
  return entry && typeof entry.expanded === 'boolean' ? entry.expanded : null
}

export const persistProcessVisibility = (
  storageKey: string,
  itemKey: string,
  expanded: boolean,
): void => {
  const storage = safeLocal()
  if (!storage || !itemKey) return
  const map = readVisibilityMap(storageKey)
  map[itemKey] = { expanded, updatedAt: Date.now() }
  const pruned = Object.entries(map)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, VISIBILITY_LIMIT)
  try {
    storage.setItem(storageKey, JSON.stringify(Object.fromEntries(pruned)))
  } catch {
    // 配额不足时保留本次会话内的交互结果
  }
}

export const reasoningItemKey = (scopeKey: string, charStart: number): string =>
  scopeKey ? `${scopeKey}:reasoning:${charStart}` : ''

export const toolItemKey = (scopeKey: string, recordKey: string): string =>
  scopeKey ? `${scopeKey}:tool:${recordKey}` : ''

/**
 * 级别 → 工作区开关。旧 outline / expanded 都算打开，collapsed 算关闭；
 * 用户没选过时由流式状态决定（流式中打开提纲，完成后收起一行）。
 */
export const isLevelOpen = (level: CotTimelineLevel): boolean => level !== 'collapsed'
