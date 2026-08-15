'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const normalizeSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const resolveDurationSeconds = (textLength: number) => {
  // Roughly 14 chars per second; short text gets a floor so it doesn't spin too fast.
  return Math.max(6, Math.min(36, textLength / 14))
}

interface SingleLineScrollerProps {
  text: string
  className?: string
  /** 仅当对应步骤仍在进行中（流式 CoT / 执行中的工具）时才允许滚动 */
  active?: boolean
}

/**
 * 单行滚动展示器：内容只占一行。
 * - active 且文本超宽时自动向左匀速滚动（跑马灯式）；已结束的步骤保持静态。
 * - hover 时暂停，方便阅读。
 * - 左右边缘做渐隐，营造“滚进滚出”的虚化感。
 */
export function SingleLineScroller({ text, className, active = false }: SingleLineScrollerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const normalized = normalizeSingleLine(text)
  const [overflowing, setOverflowing] = useState(false)

  const updateOverflow = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    setOverflowing(content.scrollWidth > container.clientWidth + 1)
  }, [])

  useLayoutEffect(() => {
    updateOverflow()

    const container = containerRef.current
    const content = contentRef.current
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateOverflow()
      })
      if (container) observer.observe(container)
      if (content) observer.observe(content)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateOverflow)
    return () => window.removeEventListener('resize', updateOverflow)
  }, [normalized, active, updateOverflow])

  if (!normalized) {
    return <div ref={containerRef} className={cn('min-w-0', className)} />
  }

  const scrolling = active && overflowing
  const edgeFade =
    'linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)'

  return (
    <div
      ref={containerRef}
      className={cn('cot-single-line-scroller relative min-w-0 overflow-hidden', className)}
      title={normalized}
      style={
        scrolling
          ? {
              maskImage: edgeFade,
              WebkitMaskImage: edgeFade,
            }
          : undefined
      }
    >
      {active ? (
        <div
          className={cn('flex w-max', scrolling && 'cot-single-line-track')}
          style={
            scrolling
              ? {
                  animationDuration: `${resolveDurationSeconds(normalized.length)}s`,
                }
              : undefined
          }
        >
          <span
            ref={contentRef}
            className={scrolling ? 'whitespace-pre pr-8' : 'whitespace-pre'}
          >
            {normalized}
          </span>
          {scrolling && (
            <span aria-hidden="true" className="whitespace-pre pr-8">
              {normalized}
            </span>
          )}
        </div>
      ) : (
        <span className="block truncate">{normalized}</span>
      )}
    </div>
  )
}
