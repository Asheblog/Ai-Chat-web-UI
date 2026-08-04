"use client"

import { RefObject, useEffect, useRef } from "react"

export type NavFlashParams = {
  /** 导航容器 ref（在其内按 data-leaf-key 查找目标叶子按钮） */
  navRef: RefObject<HTMLDivElement | null>
  /** 需要闪烁的叶子 key（搜索跳转后的位置提醒） */
  flashKey?: string | null
  /** 闪烁动画结束后的回调（宿主用于清理 flashKey） */
  onFlashDone?: () => void
  /** 展开指定 key 的祖先分组（由 shell 提供，保证目标叶子可见） */
  expandAncestors: (key: string) => void
}

/**
 * 导航项闪烁：展开目标叶子祖先分组 → 滚动到可见 → 一次性 .settings-flash 动画。
 * 动画结束后触发 onFlashDone；prefers-reduced-motion 时跳过动画直接收尾；
 * 目标不在树中时兜底收尾，避免宿主 flashKey 状态残留。
 */
export function useNavFlash({ navRef, flashKey, onFlashDone, expandAncestors }: NavFlashParams) {
  const onFlashDoneRef = useRef(onFlashDone)
  useEffect(() => {
    onFlashDoneRef.current = onFlashDone
  })

  useEffect(() => {
    if (!flashKey) return
    expandAncestors(flashKey)

    let targetEl: HTMLElement | null = null
    const onAnimationEnd = () => {
      targetEl?.removeEventListener("animationend", onAnimationEnd)
      targetEl?.classList.remove("settings-flash")
      onFlashDoneRef.current?.()
    }

    const raf1 = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const el = navRef.current?.querySelector<HTMLElement>(`[data-leaf-key="${flashKey}"]`)
        if (!el) {
          onFlashDoneRef.current?.() // 目标不在树中：兜底清理
          return
        }
        targetEl = el
        el.scrollIntoView({ behavior: "smooth", block: "nearest" })
        const reduceMotion =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        if (reduceMotion) {
          onFlashDoneRef.current?.() // 无动画路径无 animationend，直接收尾
          return
        }
        // 先移除再强制 reflow，保证连续两次定位同一项时动画可重新触发
        el.classList.remove("settings-flash")
        void el.offsetWidth
        el.classList.add("settings-flash")
        el.addEventListener("animationend", onAnimationEnd)
      })
    })
    return () => {
      window.cancelAnimationFrame(raf1)
      targetEl?.removeEventListener("animationend", onAnimationEnd)
    }
  }, [flashKey, navRef, expandAncestors])
}
