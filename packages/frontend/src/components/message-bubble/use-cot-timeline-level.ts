'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isCotTimelineLevel,
  resolveCotTimelineLevel,
  type CotTimelineLevel,
} from '@aichat/shared/cot-timeline-view'

/**
 * 折叠级别是「这条消息的查看状态」，按消息 key 存进 sessionStorage：
 * 同一条消息滚回来/重挂载仍是刚才的展开层级，不同消息互不串扰。
 */
export const COT_TIMELINE_LEVEL_STORAGE_PREFIX = 'aichat.cot_timeline_level'

const buildStorageKey = (itemKey: string) =>
  itemKey ? `${COT_TIMELINE_LEVEL_STORAGE_PREFIX}:${itemKey}` : ''

interface StoredCotTimelineLevel {
  level: CotTimelineLevel
  updatedAt: number
}

/** 读取本条消息手动选择过的级别；没选过或数据损坏时返回 null */
export const readCotTimelineLevelPreference = (itemKey: string): CotTimelineLevel | null => {
  const storageKey = buildStorageKey(itemKey)
  if (!storageKey || typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredCotTimelineLevel> | null
    return isCotTimelineLevel(parsed?.level) ? parsed.level : null
  } catch {
    return null
  }
}

export const persistCotTimelineLevelPreference = (
  itemKey: string,
  level: CotTimelineLevel | null,
) => {
  const storageKey = buildStorageKey(itemKey)
  if (!storageKey || typeof window === 'undefined') return
  try {
    if (level == null) {
      window.sessionStorage.removeItem(storageKey)
      return
    }
    const payload: StoredCotTimelineLevel = { level, updatedAt: Date.now() }
    window.sessionStorage.setItem(storageKey, JSON.stringify(payload))
  } catch {
    // sessionStorage 不可用（隐私模式 / 配额）时退化为「仅本次挂载内存态」
  }
}

interface UseCotTimelineLevelOptions {
  /** 本条消息的稳定 key；为空时退化为组件内状态，不做持久化 */
  itemKey?: string
  /** 消息仍在流式作答：用户没手动选过时自动落「提纲」 */
  isStreaming?: boolean
  /** 调用方默认级别（Battle 详情传 expanded） */
  defaultLevel?: CotTimelineLevel | null
}

/**
 * 三段折叠级别状态。
 * 优先级由 shared 的 resolveCotTimelineLevel 决定：用户手选 > 调用方默认 > 流式提纲 > 完成态一行。
 * 只有用户主动点击才会记住当前消息的级别，流式/完成之间的自动切换不会覆盖它。
 */
export function useCotTimelineLevel({
  itemKey = '',
  isStreaming = false,
  defaultLevel = null,
}: UseCotTimelineLevelOptions = {}) {
  const [preference, setPreference] = useState<CotTimelineLevel | null>(null)

  // 服务端没有 sessionStorage：挂载后再恢复偏好，避免 hydration 前后不一致
  useEffect(() => {
    setPreference(readCotTimelineLevelPreference(itemKey))
  }, [itemKey])

  const level = useMemo(
    () => resolveCotTimelineLevel({ preference, defaultLevel, isStreaming }),
    [preference, defaultLevel, isStreaming],
  )

  const setLevel = useCallback(
    (next: CotTimelineLevel) => {
      setPreference(next)
      persistCotTimelineLevelPreference(itemKey, next)
    },
    [itemKey],
  )

  const resetLevel = useCallback(() => {
    setPreference(null)
    persistCotTimelineLevelPreference(itemKey, null)
  }, [itemKey])

  return { level, setLevel, resetLevel, preference }
}
