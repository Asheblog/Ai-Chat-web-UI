'use client'

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'

export function useTextareaAutoResize(
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 200,
) {
  const [showExpand, setShowExpand] = useState(false)
  const resizeRaf = useRef<number | null>(null)
  const lastHeightRef = useRef<number>(0)

  const scheduleResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    if (resizeRaf.current) {
      cancelAnimationFrame(resizeRaf.current)
    }
    resizeRaf.current = requestAnimationFrame(() => {
      el.style.height = 'auto'
      const nextHeight = Math.min(el.scrollHeight, maxHeight)
      if (lastHeightRef.current !== nextHeight) {
        el.style.height = `${nextHeight}px`
        lastHeightRef.current = nextHeight
      }
      setShowExpand(el.scrollHeight > maxHeight)
    })
  }, [maxHeight, textareaRef])

  useEffect(() => {
    scheduleResize()
    return () => {
      if (resizeRaf.current) {
        cancelAnimationFrame(resizeRaf.current)
        resizeRaf.current = null
      }
    }
  }, [scheduleResize, value])

  return { showExpand, scheduleResize }
}
