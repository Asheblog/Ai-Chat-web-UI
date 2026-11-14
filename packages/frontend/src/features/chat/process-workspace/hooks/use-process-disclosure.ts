'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CotTimelineLevel } from '@aichat/shared/cot-timeline-view'
import {
  REASONING_VISIBILITY_STORAGE_KEY,
  TOOL_VISIBILITY_STORAGE_KEY,
  persistProcessLevel,
  persistProcessVisibility,
  readProcessLevel,
  readProcessVisibility,
} from '../model/disclosure'

interface UseProcessLevelOptions {
  scopeKey: string
  /** 调用方默认展开（Battle 详情）；用户手选优先 */
  defaultExpanded?: boolean
}

/**
 * 工作区开关沿用旧的级别偏好：
 * - 有手选偏好就按偏好（outline / expanded 都是打开，collapsed 是关闭）
 * - 没有偏好时由 defaultExpanded 决定，默认关闭
 * 流式状态不再自动展开：流式信息放在一行摘要里，答案区不被挤压。
 */
export function useProcessLevel({ scopeKey, defaultExpanded = false }: UseProcessLevelOptions) {
  const [preference, setPreference] = useState<CotTimelineLevel | null>(null)

  useEffect(() => {
    setPreference(readProcessLevel(scopeKey))
  }, [scopeKey])

  const level: CotTimelineLevel = preference ?? (defaultExpanded ? 'expanded' : 'collapsed')
  const open = level !== 'collapsed'

  const setOpen = useCallback(
    (next: boolean) => {
      const nextLevel: CotTimelineLevel = next ? (defaultExpanded ? 'expanded' : 'outline') : 'collapsed'
      setPreference(nextLevel)
      persistProcessLevel(scopeKey, nextLevel)
    },
    [scopeKey, defaultExpanded],
  )

  return { level, open, setOpen }
}

interface UseProcessVisibilityOptions {
  itemKey: string
  storageKey?: string
  defaultExpanded?: boolean
}

/** 单条记录/推理段的展开记忆：itemKey 格式与旧实现一致。 */
export function useProcessVisibility({
  itemKey,
  storageKey = TOOL_VISIBILITY_STORAGE_KEY,
  defaultExpanded = false,
}: UseProcessVisibilityOptions) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  useEffect(() => {
    const stored = readProcessVisibility(storageKey, itemKey)
    setExpanded(stored ?? defaultExpanded)
  }, [storageKey, itemKey, defaultExpanded])

  const set = useCallback(
    (next: boolean) => {
      setExpanded(next)
      persistProcessVisibility(storageKey, itemKey, next)
    },
    [storageKey, itemKey],
  )

  const toggle = useCallback(() => set(!expanded), [set, expanded])

  return { expanded, setExpanded: set, toggle }
}

export { REASONING_VISIBILITY_STORAGE_KEY, TOOL_VISIBILITY_STORAGE_KEY }
