/**
 * TypewriterReasoning Component
 *
 * 实现思维链内容的逐字打字机效果显示
 * - 支持流式内容实时渲染
 * - 性能优化：使用requestAnimationFrame
 * - 自适应降级：长文本自动批量显示
 */

import { useEffect, useState, useRef, useMemo } from 'react'

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
  const initialSyncRef = useRef(clampedInitial)

  // 判断是否为长文本，启用批量模式
  const isLongText = useMemo(() => text.length > longTextThreshold, [text.length, longTextThreshold])
  const charsPerFrame = isLongText ? batchSize : 1

  useEffect(() => {
    // 刷新/Hydrate 后同步已播放长度，避免重复动画
    if (clampedInitial > initialSyncRef.current || indexRef.current < clampedInitial) {
      indexRef.current = clampedInitial
      initialSyncRef.current = clampedInitial
      setDisplayText(text.slice(0, clampedInitial))
    }
  }, [clampedInitial, text])

  useEffect(() => {
    // 如果不在流式传输中，或文本已完全显示，直接显示全部内容
    if (!isStreaming || displayText === text) {
      if (displayText !== text) {
        setDisplayText(text)
        indexRef.current = text.length
      }
      return
    }

    // 如果文本长度减少（如重新开始），重置状态
    if (text.length < indexRef.current) {
      indexRef.current = 0
      setDisplayText('')
      lastTimeRef.current = 0
    }

    // 打字机动画逻辑
    const animate = (timestamp: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp
      }
      // 控制显示速度
      const elapsed = timestamp - lastTimeRef.current
      if (elapsed >= speed) {
        const currentIndex = indexRef.current
        if (currentIndex < text.length) {
          const steps = Math.max(1, Math.floor(elapsed / speed))
          const nextIndex = Math.min(currentIndex + charsPerFrame * steps, text.length)
          indexRef.current = nextIndex
          setDisplayText(text.slice(0, nextIndex))
        }
        lastTimeRef.current = timestamp
      }

      // 继续动画直到显示完毕
      if (indexRef.current < text.length) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    // 启动动画
    lastTimeRef.current = 0
    rafRef.current = requestAnimationFrame(animate)

    // 清理函数
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, isStreaming, speed, charsPerFrame]) // displayText intentionally omitted to prevent infinite loop

  return (
    <span className="block w-full break-words whitespace-pre-wrap">
      {displayText}
      {isStreaming && indexRef.current < text.length && (
        <span className="typewriter-cursor ml-0.5 inline-block w-[2px] h-[1em] bg-current align-middle animate-blink" />
      )}
    </span>
  )
}
