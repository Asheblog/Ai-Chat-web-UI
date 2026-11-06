'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

export type PersonalSettingsSection = 'profile' | 'skills' | 'shares' | 'security'

export const PERSONAL_SECTION_ANCHOR: Record<PersonalSettingsSection, string> = {
  profile: 'settings-personal-preferences',
  skills: 'settings-personal-skills',
  shares: 'settings-share-management',
  security: 'settings-personal-security',
}

const SECTION_BY_HASH: Record<string, PersonalSettingsSection> = Object.fromEntries(
  Object.entries(PERSONAL_SECTION_ANCHOR).map(([section, anchor]) => [anchor, section]),
) as Record<string, PersonalSettingsSection>

const isSection = (value: string): value is PersonalSettingsSection => value in PERSONAL_SECTION_ANCHOR

export function resolvePersonalSectionFromHash(hash: string): PersonalSettingsSection | null {
  return SECTION_BY_HASH[hash.replace(/^#/, '')] ?? null
}

export function getPersonalSectionAnchor(section: PersonalSettingsSection) {
  return PERSONAL_SECTION_ANCHOR[section]
}

const SECTION_EVENT = 'aichat:personal-section'

const readSection = (): PersonalSettingsSection => {
  if (typeof window === 'undefined') return 'profile'
  return resolvePersonalSectionFromHash(window.location.hash) ?? 'profile'
}

const subscribe = (listener: () => void) => {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('hashchange', listener)
  window.addEventListener('popstate', listener)
  window.addEventListener(SECTION_EVENT, listener)
  return () => {
    window.removeEventListener('hashchange', listener)
    window.removeEventListener('popstate', listener)
    window.removeEventListener(SECTION_EVENT, listener)
  }
}

/** URL hash 是独立个人设置页的唯一页签来源；弹窗仍使用自己的状态。 */
export function usePersonalSectionFromHash(): PersonalSettingsSection {
  const section = useSyncExternalStore(subscribe, readSection, () => 'profile' as PersonalSettingsSection)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  // 服务端没有 window hash；首帧统一 profile，挂载后再应用深链，避免水合不一致。
  return hydrated ? section : 'profile'
}

export function setPersonalSection(section: PersonalSettingsSection, options?: { replace?: boolean }) {
  if (typeof window === 'undefined') return
  const hash = `#${PERSONAL_SECTION_ANCHOR[section]}`
  if (window.location.hash === hash) return
  const url = `${window.location.pathname}${window.location.search}${hash}`
  if (options?.replace) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(window.history.state, '', url)
  window.dispatchEvent(new Event(SECTION_EVENT))
}

export { isSection }
