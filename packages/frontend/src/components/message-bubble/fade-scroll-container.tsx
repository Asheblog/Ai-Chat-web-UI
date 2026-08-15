'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

const FADE_HEIGHT_PX = 28

interface FadeScrollContainerProps {
  children: ReactNode
  className?: string
  /** Extra class applied to the actual scrolling viewport. */
  viewportClassName?: string
  /** Vertical scroll kicks in above this height. */
  maxHeightClassName?: string
  /** When this value changes the viewport sticks to the bottom (streaming typewriter). */
  stickToBottomKey?: string | number | null
}

interface EdgeMaskState {
  top: boolean
  bottom: boolean
}

/**
 * Vertical scroll container with top/bottom fade masks.
 * No fade when content fits; fade edges appear only while scrolling is possible
 * and the corresponding edge is not at its end.
 */
export function FadeScrollContainer({
  children,
  className,
  viewportClassName,
  maxHeightClassName = 'max-h-72',
  stickToBottomKey = null,
}: FadeScrollContainerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [maskState, setMaskState] = useState<EdgeMaskState>({ top: false, bottom: false })

  const updateMask = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scrollable = viewport.scrollHeight > viewport.clientHeight + 2
    if (!scrollable) {
      setMaskState((current) =>
        current.top === false && current.bottom === false
          ? current
          : { top: false, bottom: false },
      )
      return
    }

    const top = viewport.scrollTop > 2
    const bottom = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2
    setMaskState((current) =>
      current.top === top && current.bottom === bottom ? current : { top, bottom },
    )
  }, [])

  useLayoutEffect(() => {
    updateMask()
  }, [updateMask])

  useLayoutEffect(() => {
    if (stickToBottomKey == null) return
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
    updateMask()
  }, [stickToBottomKey, updateMask])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport) return

    viewport.addEventListener('scroll', updateMask, { passive: true })
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateMask()
          })
        : null
    observer?.observe(viewport)
    if (content) observer?.observe(content)
    window.addEventListener('resize', updateMask)

    return () => {
      viewport.removeEventListener('scroll', updateMask)
      observer?.disconnect()
      window.removeEventListener('resize', updateMask)
    }
  }, [updateMask])

  const { top, bottom } = maskState
  let maskImage: string | undefined
  if (top && bottom) {
    maskImage = `linear-gradient(to bottom, transparent 0, black ${FADE_HEIGHT_PX}px, black calc(100% - ${FADE_HEIGHT_PX}px), transparent 100%)`
  } else if (top) {
    maskImage = `linear-gradient(to bottom, transparent 0, black ${FADE_HEIGHT_PX}px, black 100%)`
  } else if (bottom) {
    maskImage = `linear-gradient(to bottom, black 0, black calc(100% - ${FADE_HEIGHT_PX}px), transparent 100%)`
  }

  return (
    <div className={cn('relative min-h-0 min-w-0', className)}>
      <div
        ref={viewportRef}
        onScroll={updateMask}
        className={cn(
          'min-h-0 min-w-0 overflow-y-auto overscroll-contain',
          maxHeightClassName,
          viewportClassName,
        )}
        style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
      >
        <div ref={contentRef} className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  )
}
