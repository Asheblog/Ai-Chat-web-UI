'use client'

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'

export function useTextareaAutoResize(
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 200,
) {
  const [showExpand, setShowExpand] = useState(false)
  const resizeRaf = useRef<number | null>(null)

  const scheduleResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    if (resizeRaf.current) {
      cancelAnimationFrame(resizeRaf.current)
    }
    resizeRaf.current = requestAnimationFrame(() => {
      // 从 CSS 计算的 min-height 获取最小高度
      const computedStyle = window.getComputedStyle(el)
      const cssMinHeight = parseFloat(computedStyle.minHeight) || 40

      // 如果内容为空，直接使用最小高度
      if (!el.value || el.value.trim() === '') {
        el.style.height = `${cssMinHeight}px`
        setShowExpand(false)
        return
      }

      // 保存当前滚动位置
      const scrollTop = el.scrollTop

      // 临时设置高度为 auto 以获取准确的 scrollHeight
      el.style.height = 'auto'

      // 强制触发重排以获取正确的 scrollHeight
      const contentHeight = el.scrollHeight

      // 计算目标高度，考虑最小和最大高度
      const nextHeight = Math.max(cssMinHeight, Math.min(contentHeight, maxHeight))

      // 应用新高度
      el.style.height = `${nextHeight}px`

      // 恢复滚动位置
      el.scrollTop = scrollTop

      setShowExpand(contentHeight > maxHeight)
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
