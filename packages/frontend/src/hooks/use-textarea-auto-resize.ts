'use client'

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'

const MIRROR_ATTR = 'data-composer-textarea-mirror'
const DEFAULT_MIN_HEIGHT = 40

const SHARED_MIRROR_PROPERTIES = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'wordSpacing',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
] as const

/**
 * 用离屏镜像测量 input 的真实内容高度，避免反复修改真实 textarea 的 height
 * 触发整段 composer 重排。镜像只在挂载时写入一次结构，之后的测量只更新文本。
 */
export function useTextareaAutoResize(
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 200,
  /** 可见 composer 变化时触发重新测量；ref 对象本身在双 composer 间共享。 */
  activeTarget?: unknown,
) {
  const [showExpand, setShowExpand] = useState(false)
  const mirrorRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeRaf = useRef<number | null>(null)
  const lastAppliedHeight = useRef<number | null>(null)
  const latestValueRef = useRef(value)
  latestValueRef.current = value

  const ensureMirror = useCallback((): HTMLTextAreaElement | null => {
    if (typeof document === 'undefined') return null
    if (mirrorRef.current?.isConnected) return mirrorRef.current
    const mirror = document.createElement('textarea')
    mirror.setAttribute(MIRROR_ATTR, 'true')
    mirror.setAttribute('aria-hidden', 'true')
    mirror.setAttribute('tabindex', '-1')
    mirror.setAttribute('readonly', '')
    mirror.style.position = 'fixed'
    mirror.style.top = '-10000px'
    mirror.style.left = '-10000px'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.overflow = 'hidden'
    mirror.style.height = '0px'
    mirror.style.minHeight = '0px'
    mirror.style.maxHeight = 'none'
    mirror.style.resize = 'none'
    document.body.appendChild(mirror)
    mirrorRef.current = mirror
    return mirror
  }, [])

  const scheduleResize = useCallback(() => {
    if (typeof window === 'undefined') return
    if (resizeRaf.current !== null) return
    resizeRaf.current = window.requestAnimationFrame(() => {
      resizeRaf.current = null
      const el = textareaRef.current
      const mirror = ensureMirror()
      if (!el || !mirror) return

      const computed = window.getComputedStyle(el)
      const minHeight = parseFloat(computed.minHeight) || DEFAULT_MIN_HEIGHT
      const nextValue = latestValueRef.current
      if (mirror.value !== nextValue) mirror.value = nextValue
      for (const property of SHARED_MIRROR_PROPERTIES) {
        mirror.style[property] = computed[property]
      }
      mirror.style.width = `${el.clientWidth || parseFloat(computed.width) || 0}px`

      const contentHeight = nextValue.length === 0 ? minHeight : mirror.scrollHeight
      const nextHeight = Math.max(minHeight, Math.min(contentHeight, maxHeight))
      if (lastAppliedHeight.current !== nextHeight) {
        lastAppliedHeight.current = nextHeight
        el.style.height = `${nextHeight}px`
      }
      const nextShowExpand = contentHeight > maxHeight
      setShowExpand((current) => (current === nextShowExpand ? current : nextShowExpand))
    })
  }, [ensureMirror, maxHeight, textareaRef])

  useEffect(() => {
    lastAppliedHeight.current = null
    // 断点切换发生在 DOM 提交后：可见 composer 的 ref 此时才指向新节点，
    // 在同一提交内直接测量会读到旧的隐藏节点。等下一帧再测量。
    scheduleResize()
  }, [activeTarget, scheduleResize])

  useEffect(() => {
    scheduleResize()
  }, [activeTarget, scheduleResize, value])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => scheduleResize()
    window.addEventListener('resize', onResize)
    const el = textareaRef.current
    let lastWidth = el?.clientWidth ?? 0
    const observer =
      typeof ResizeObserver !== 'undefined' && el
        ? new ResizeObserver(() => {
            const width = el.clientWidth
            if (width === lastWidth) return
            lastWidth = width
            scheduleResize()
          })
        : null
    observer?.observe(el!)
    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [activeTarget, scheduleResize, textareaRef])

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    let active = true
    const onFontsLoaded = () => scheduleResize()
    document.fonts.addEventListener?.('loadingdone', onFontsLoaded)
    void document.fonts.ready.then(() => {
      if (!active) return
      onFontsLoaded()
    })
    return () => {
      active = false
      document.fonts.removeEventListener?.('loadingdone', onFontsLoaded)
    }
  }, [scheduleResize])

  useEffect(() => {
    return () => {
      if (resizeRaf.current !== null) {
        window.cancelAnimationFrame(resizeRaf.current)
        resizeRaf.current = null
      }
      if (mirrorRef.current) {
        mirrorRef.current.remove()
        mirrorRef.current = null
      }
    }
  }, [])

  return { showExpand, scheduleResize }
}
