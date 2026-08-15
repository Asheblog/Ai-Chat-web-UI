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
}

/**
 * Single-line scrolling display for collapsed CoT / tool cards.
 * Static when it fits; horizontal marquee when it overflows.
 * Pauses on hover and fades both horizontal edges while scrolling.
 */
export function SingleLineScroller({ text, className }: SingleLineScrollerProps) {
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
  }, [normalized, updateOverflow])

  if (!normalized) {
    return <div ref={containerRef} className={cn('min-w-0', className)} />
  }

  const edgeFade =
    'linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)'

  return (
    <div
      ref={containerRef}
      className={cn('cot-single-line-scroller relative min-w-0 overflow-hidden', className)}
      title={normalized}
      style={
        overflowing
          ? {
              maskImage: edgeFade,
              WebkitMaskImage: edgeFade,
            }
          : undefined
      }
    >
      <div
        className={cn('flex w-max', overflowing && 'cot-single-line-track')}
        style={
          overflowing
            ? {
                animationDuration: `${resolveDurationSeconds(normalized.length)}s`,
              }
            : undefined
        }
      >
        <span
          ref={contentRef}
          className={overflowing ? 'whitespace-pre pr-8' : 'whitespace-pre'}
        >
          {normalized}
        </span>
        {overflowing && (
          <span
            aria-hidden="true"
            className={overflowing ? 'whitespace-pre pr-8' : 'whitespace-pre'}
          >
            {normalized}
          </span>
        )}
      </div>
    </div>
  )
}
