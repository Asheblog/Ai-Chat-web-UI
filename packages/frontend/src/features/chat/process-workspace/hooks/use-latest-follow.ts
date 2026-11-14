'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD = 48

/**
 * 单容器跟随：容器只有一个滚动区，贴底时跟随新记录，用户向上翻就暂停跟随，
 * 回来点"回到最新"再贴上。卸载重挂载由 remember 的 key 恢复位置。
 */
export function useLatestFollow(followKey: string | number, active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)

  const scrollToLatest = useCallback(() => {
    const node = ref.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    setFollowing(true)
  }, [])

  const onScroll = useCallback(() => {
    const node = ref.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    setFollowing(distance <= BOTTOM_THRESHOLD)
  }, [])

  useEffect(() => {
    if (!active || !following) return
    const node = ref.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [followKey, active, following])

  return { ref, following: active ? following : true, onScroll, scrollToLatest }
}
