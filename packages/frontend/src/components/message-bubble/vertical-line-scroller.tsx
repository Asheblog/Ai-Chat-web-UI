'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const LINE_INTERVAL_MS = 1200

const splitLines = (value: string): string[] => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  // 去掉末尾空行，避免“最后一行”是空白
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

interface VerticalLineScrollerProps {
  text: string
  className?: string
  /** 仅当对应步骤仍在进行中（流式 CoT）时才允许滚动 */
  active?: boolean
}

/**
 * 单行上下滚动展示器：视口只显示一行。
 * - active 且多行时逐行向下滚动；滚到当前最后一行后停住等待新行追加（不循环）。
 * - active 变为 false（CoT 输出结束）时直接停在最后一行，不再继续滚动。
 * - hover 时暂停，方便阅读。
 * - 上下边缘做渐隐，营造“滚进滚出”的虚化感。
 */
export function VerticalLineScroller({
  text,
  className,
  active = false,
}: VerticalLineScrollerProps) {
  const lines = useMemo(() => splitLines(text), [text])
  const lineCount = lines.length
  const [index, setIndex] = useState(() => (active ? 0 : Math.max(0, lineCount - 1)))
  const [paused, setPaused] = useState(false)
  const indexRef = useRef(index)
  indexRef.current = index
  const lineCountRef = useRef(lineCount)
  lineCountRef.current = lineCount

  const scrolling = active && lineCount > 1

  // 输出结束：直接停在最后一行
  useEffect(() => {
    if (active) return
    const last = Math.max(0, lineCount - 1)
    if (indexRef.current !== last) {
      indexRef.current = last
      setIndex(last)
    }
  }, [active, lineCount])

  // 文本变化时夹紧游标：流式追加保持当前行继续往下滚，缩短则回退到最后一行
  useEffect(() => {
    if (lineCount === 0) {
      if (indexRef.current !== 0) {
        indexRef.current = 0
        setIndex(0)
      }
      return
    }
    const clamped = Math.min(indexRef.current, lineCount - 1)
    if (clamped !== indexRef.current) {
      indexRef.current = clamped
      setIndex(clamped)
    }
  }, [lineCount])

  // 活跃时逐行向下滚动；到当前最后一行即停，等待新行追加。
  // 计时器不随 lineCount 重启：流式快速追加时也能持续推进，而不是一直停在第一行。
  useEffect(() => {
    if (!scrolling || paused) return
    const timer = window.setInterval(() => {
      const count = lineCountRef.current
      if (count <= 1) return
      const next = Math.min(indexRef.current + 1, count - 1)
      if (next !== indexRef.current) {
        indexRef.current = next
        setIndex(next)
      }
    }, LINE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [scrolling, paused])

  if (lineCount === 0) {
    return <div className={cn('h-4 min-w-0', className)} />
  }

  const edgeFade =
    'linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%)'

  return (
    <div
      className={cn('cot-vertical-line-scroller relative h-4 min-w-0 overflow-hidden', className)}
      title={text}
      data-testid="cot-vertical-line-scroller"
      data-line-count={lineCount}
      data-line-index={index}
      data-active={active ? 'true' : 'false'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={
        scrolling
          ? {
              maskImage: edgeFade,
              WebkitMaskImage: edgeFade,
            }
          : undefined
      }
    >
      <div
        className={cn(
          'will-change-transform',
          scrolling && 'transition-transform duration-300 ease-out',
        )}
        style={{ transform: `translateY(-${index}rem)` }}
      >
        {lines.map((line, lineIndex) => (
          <span key={lineIndex} className="block h-4 whitespace-pre text-xs leading-4">
            {line}
          </span>
        ))}
      </div>
    </div>
  )
}
