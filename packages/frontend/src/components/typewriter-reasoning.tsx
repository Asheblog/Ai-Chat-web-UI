/**
 * TypewriterReasoning Component
 *
 * 实现思维链内容的逐字打字机效果显示
 * - 支持流式内容实时渲染
 * - 追加不重置游标（避免开头前进又后退）
 * - 性能优化：使用 requestAnimationFrame
 * - 自适应降级：长文本自动批量显示
 */

import { useEffect, useState, useRef, useMemo } from 'react'
import { resolveTypewriterAdvanceIndex } from '@/components/typewriter-advance'

interface TypewriterReasoningProps {
  /** 完整的思维链文本内容 */
  text: string
  /** 是否正在流式传输中 */
  isStreaming: boolean
  /** 初始已播放的字符数，用于刷新恢复 */
  initialPlayedLength?: number
  /** 打字速度（毫秒/字符），默认20ms */
  speed?: number
  /** 长文本阈值，超过此长度自动批量显示（默认500字符） */
  longTextThreshold?: number
  /** 长文本批量大小（默认每次显示3个字符） */
  batchSize?: number
}

export function TypewriterReasoning({
  text,
  isStreaming,
  initialPlayedLength = 0,
  speed = 30,
  longTextThreshold = 240,
  batchSize = 8,
}: TypewriterReasoningProps) {
  const clampedInitial = useMemo(
    () => Math.max(0, Math.min(Math.floor(initialPlayedLength), text.length)),
    [initialPlayedLength, text.length],
  )
  const [displayText, setDisplayText] = useState(() => text.slice(0, clampedInitial))
  const rafRef = useRef<number>()
  const lastTimeRef = useRef(0)
  const indexRef = useRef(clampedInitial)
  const prevTextRef = useRef(text)
  const targetTextRef = useRef(text)
  targetTextRef.current = text

  const isLongText = useMemo(() => text.length > longTextThreshold, [text.length, longTextThreshold])
  const charsPerFrame = isLongText ? batchSize : 1

  // hydrate / 恢复：只允许游标前进
  useEffect(() => {
    if (clampedInitial > indexRef.current) {
      indexRef.current = clampedInitial
      setDisplayText(text.slice(0, clampedInitial))
    }
  }, [clampedInitial, text])

  // 文本变更：追加保游标；缩短/分叉按公共前缀夹紧
  useEffect(() => {
    const previous = prevTextRef.current
    if (previous === text) return
    const nextIndex = resolveTypewriterAdvanceIndex(previous, text, indexRef.current)
    prevTextRef.current = text
    indexRef.current = nextIndex
    setDisplayText((current) => {
      const next = text.slice(0, nextIndex)
      return current === next ? current : next
    })
  }, [text])

  useEffect(() => {
    if (!isStreaming) {
      if (indexRef.current !== text.length || displayText !== text) {
        indexRef.current = text.length
        setDisplayText(text)
      }
      return
    }

    if (indexRef.current >= text.length) {
      if (displayText !== text) setDisplayText(text)
      return
    }

    const animate = (timestamp: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp
      }
      const elapsed = timestamp - lastTimeRef.current
      const target = targetTextRef.current
      if (elapsed >= speed) {
        const currentIndex = indexRef.current
        if (currentIndex < target.length) {
          const steps = Math.max(1, Math.floor(elapsed / speed))
          const nextIndex = Math.min(currentIndex + charsPerFrame * steps, target.length)
          indexRef.current = nextIndex
          setDisplayText(target.slice(0, nextIndex))
        }
        lastTimeRef.current = timestamp
      }

      if (indexRef.current < targetTextRef.current.length) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isStreaming, speed, charsPerFrame])

  return (
    <span className="block w-full break-words whitespace-pre-wrap">
      {displayText}
      {isStreaming && indexRef.current < text.length && (
        <span className="typewriter-cursor ml-0.5 inline-block w-[2px] h-[1em] bg-current align-middle animate-blink" />
      )}
    </span>
  )
}
