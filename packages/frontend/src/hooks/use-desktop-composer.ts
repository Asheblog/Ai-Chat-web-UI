'use client'

import { useSyncExternalStore } from 'react'

const DESKTOP_COMPOSER_QUERY = '(min-width: 768px)'

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined
  }
  const query = window.matchMedia(DESKTOP_COMPOSER_QUERY)
  query.addEventListener('change', onStoreChange)
  return () => query.removeEventListener('change', onStoreChange)
}

const getSnapshot = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DESKTOP_COMPOSER_QUERY).matches
}

const getServerSnapshot = () => false

/**
 * 与 Tailwind 默认 md(768px) 对齐，决定哪个 composer 持有共享 textareaRef。
 * SSR 固定按移动端渲染，水合后再切换到实际断点，避免首帧不一致。
 */
export const useDesktopComposer = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
