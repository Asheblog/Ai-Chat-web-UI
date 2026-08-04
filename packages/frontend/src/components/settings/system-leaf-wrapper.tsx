"use client"

import { ReactNode, useEffect, useRef } from "react"
import { consumeFlash, type FlashRequest } from "./settings-flash-bus"

/** 卡定位重试参数：页面数据加载完成前卡可能未渲染，最多重试约 1.5s */
const CARD_RETRY_ATTEMPTS = 10
const CARD_RETRY_DELAY_MS = 150

/** 用户偏好减少动态效果时跳过闪烁动画，仅滚动定位。 */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * 在宿主容器内查找卡元素并滚动到可见（reduced-motion 时跳过闪烁动画）。
 * 查找限定在容器内：Dialog 与路由页可能同时渲染同一叶子页，
 * 全局查询会闪到被遮挡的背景宿主上。返回是否已定位到卡。
 */
function scrollToCard(container: HTMLElement, cardKey: string): boolean {
  const el = container.querySelector<HTMLElement>(`[data-card-key="${cardKey}"]`)
  if (!el) return false
  el.scrollIntoView({ behavior: "smooth", block: "nearest" })
  if (!prefersReducedMotion()) {
    // 先移除再强制 reflow，保证连续两次定位同一卡时动画可重新触发
    el.classList.remove("settings-flash")
    void el.offsetWidth
    el.classList.add("settings-flash")
  }
  return true
}

/**
 * SystemLeafWrapper: 系统设置叶子页的定位包装器。
 * 挂载时消费 flash-bus 中未处理的定位请求（覆盖 dynamic 异步挂载时序），
 * 已挂载页面通过 `aichat:settings-flash-card` 事件热更新定位。
 * 仅处理 leafKey + hostId 均匹配自身的请求；重试链随组件卸载取消，
 * 且被更新的请求覆盖后旧链自动失效（代际保护）。
 */
export function SystemLeafWrapper({
  leafKey,
  hostId,
  children,
}: {
  leafKey: string
  /** 宿主标识（"dialog" / "layout"），与 flash-bus 请求的 hostId 精确匹配 */
  hostId?: string
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const retryTimersRef = useRef<number[]>([])
  const requestSeqRef = useRef(0)

  useEffect(() => {
    const timers = retryTimersRef.current

    const handleRequest = (request: FlashRequest) => {
      if (request.leafKey !== leafKey || request.hostId !== hostId) return
      if (!request.cardKey) return
      // 请求已被处理：清掉总线兜底，避免陈旧请求在下次挂载时"复活"
      consumeFlash(leafKey, hostId)
      const container = containerRef.current
      if (!container) return
      const seq = ++requestSeqRef.current
      const attempt = (n: number) => {
        if (seq !== requestSeqRef.current) return // 已被更新的请求覆盖
        if (scrollToCard(container, request.cardKey as string)) return
        if (n < CARD_RETRY_ATTEMPTS) {
          timers.push(window.setTimeout(() => attempt(n + 1), CARD_RETRY_DELAY_MS))
        }
      }
      attempt(0)
    }

    // 挂载前已发出的请求（dynamic 加载期间）由 lastRequest 兜底
    const pending = consumeFlash(leafKey, hostId)
    if (pending) handleRequest(pending)

    const handler = (event: Event) => {
      handleRequest((event as CustomEvent<FlashRequest>).detail)
    }
    window.addEventListener("aichat:settings-flash-card", handler as EventListener)
    return () => {
      window.removeEventListener("aichat:settings-flash-card", handler as EventListener)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.length = 0
      requestSeqRef.current += 1 // 使未决重试链失效
    }
  }, [leafKey, hostId])

  return <div ref={containerRef}>{children}</div>
}
