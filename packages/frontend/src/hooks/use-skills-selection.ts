'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listSkillCatalog } from '@/features/skills/api'

const BUILTIN_SKILL_SLUGS = new Set([
  'web-search',
  'python-runner',
  'url-reader',
  'document-search',
  'knowledge-base-search',
])

export interface SkillOption {
  slug: string
  label: string
  description?: string
  enabled: boolean
}

export const useSkillsSelection = () => {
  const [extraSkillsCatalog, setExtraSkillsCatalog] = useState<
    Array<{ slug: string; displayName: string; description?: string | null }>
  >([])
  const [enabledExtraSkills, setEnabledExtraSkills] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    listSkillCatalog()
      .then((response) => {
        if (cancelled) return
        const list = Array.isArray(response?.data) ? response.data : []
        const filtered = list
          .map((item) => ({
            slug: String(item.slug || '').trim(),
            displayName: String(item.displayName || item.slug || '').trim(),
            description: item.description || null,
          }))
          .filter((item) => item.slug.length > 0 && !BUILTIN_SKILL_SLUGS.has(item.slug))
        setExtraSkillsCatalog(filtered)
        setEnabledExtraSkills((prev) =>
          prev.filter((slug) => filtered.some((item) => item.slug === slug)),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setExtraSkillsCatalog([])
          setEnabledExtraSkills([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const skillOptions = useMemo<SkillOption[]>(() => {
    return extraSkillsCatalog.map((item) => ({
      slug: item.slug,
      label: item.displayName || item.slug,
      description: item.description || undefined,
      enabled: enabledExtraSkills.includes(item.slug),
    }))
  }, [enabledExtraSkills, extraSkillsCatalog])

  const toggleSkillOption = useCallback((slug: string, enabled: boolean) => {
    const normalized = slug.trim()
    if (!normalized) return
    setEnabledExtraSkills((prev) => {
      if (enabled) {
        if (prev.includes(normalized)) return prev
        return [...prev, normalized]
      }
      return prev.filter((item) => item !== normalized)
    })
  }, [])

  return {
    enabledExtraSkills,
    skillOptions,
    toggleSkillOption,
  }
}
