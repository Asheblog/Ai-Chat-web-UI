'use client'

import { useEffect, useState } from 'react'

/**
 * 工作区布局模式。断点是产品约定（≥1440 双栏 / 768—1439 覆盖 / <768 全屏），
 * 用 matchMedia 而不是改 tailwind/token 断点，避免动到共享配置。
 * SSR 与 jsdom 默认 overlay：覆盖模式在两种环境下都可安全渲染。
 */
export type ProcessLayoutMode = 'sidebar' | 'overlay' | 'fullscreen'

export const PROCESS_WIDE_QUERY = '(min-width: 1440px)'
export const PROCESS_MEDIUM_QUERY = '(min-width: 768px)'

const resolveMode = (wide: boolean, medium: boolean): ProcessLayoutMode =>
  wide ? 'sidebar' : medium ? 'overlay' : 'fullscreen'

export function useProcessLayoutMode(): ProcessLayoutMode {
  const [mode, setMode] = useState<ProcessLayoutMode>('overlay')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const wide = window.matchMedia(PROCESS_WIDE_QUERY)
    const medium = window.matchMedia(PROCESS_MEDIUM_QUERY)
    const sync = () => setMode(resolveMode(wide.matches, medium.matches))
    sync()
    wide.addEventListener?.('change', sync)
    medium.addEventListener?.('change', sync)
    return () => {
      wide.removeEventListener?.('change', sync)
      medium.removeEventListener?.('change', sync)
    }
  }, [])

  return mode
}
