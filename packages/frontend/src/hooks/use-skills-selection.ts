'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listSessionSkillOptions, updateSessionSkillBinding } from '@/features/skills/api'
import { useAuthStore } from '@/store/auth-store'
import type { SkillRuntimeReference } from '@/types'

export interface SkillOption {
  skillId: number
  versionId: number | null
  slug: string
  label: string
  description?: string
  enabled: boolean
  updating?: boolean
  sourceLabel?: string
  licenseName?: string | null
}

export const useSkillsSelection = (sessionId?: number | null) => {
  const [extraSkillsCatalog, setExtraSkillsCatalog] = useState<
    Array<{
      id: number
      versionId: number | null
      slug: string
      displayName: string
      description?: string | null
      enabled: boolean
      sourceLabel?: string
      licenseName?: string | null
    }>
  >([])
  const [updatingSkillIds, setUpdatingSkillIds] = useState<number[]>([])
  const actorState = useAuthStore((state) => state.actorState)
  const canUsePrivateSkills = actorState === 'authenticated' && Boolean(sessionId)

  useEffect(() => {
    let cancelled = false
    if (!canUsePrivateSkills || !sessionId) {
      setExtraSkillsCatalog([])
      return () => {
        cancelled = true
      }
    }
    listSessionSkillOptions(sessionId)
      .then((response) => {
        if (cancelled) return
        const list = Array.isArray(response?.data?.items) ? response.data.items : []
        const mapped = list
          .map((item) => ({
            id: Number(item.id),
            versionId: item.defaultVersion?.id ?? null,
            slug: String(item.slug || '').trim(),
            displayName: String(item.displayName || item.slug || '').trim(),
            description: item.description || null,
            enabled: Boolean(item.sessionBinding?.enabled && item.sessionBinding.versionId === item.defaultVersion?.id),
            sourceLabel: item.sourceKey || item.sourceType || undefined,
            licenseName: item.licenseName ?? null,
          }))
          .filter((item) => item.id > 0 && item.slug.length > 0)
        setExtraSkillsCatalog(mapped)
      })
      .catch(() => {
        if (!cancelled) {
          setExtraSkillsCatalog([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [canUsePrivateSkills, sessionId])

  const skillOptions = useMemo<SkillOption[]>(() => {
    return extraSkillsCatalog.map((item) => ({
      skillId: item.id,
      versionId: item.versionId,
      slug: item.slug,
      label: item.displayName || item.slug,
      description: item.description || undefined,
      enabled: item.enabled,
      updating: updatingSkillIds.includes(item.id),
      sourceLabel: item.sourceLabel,
      licenseName: item.licenseName,
    }))
  }, [extraSkillsCatalog, updatingSkillIds])

  const enabledExtraSkills = useMemo<SkillRuntimeReference[]>(() => {
    return extraSkillsCatalog
      .filter((item) => item.enabled && item.versionId)
      .map((item) => ({ skillId: item.id, versionId: item.versionId! }))
  }, [extraSkillsCatalog])

  const toggleSkillOption = useCallback(async (skillId: number, enabled: boolean) => {
    if (!sessionId || actorState !== 'authenticated') return
    const skill = extraSkillsCatalog.find((item) => item.id === skillId)
    if (!skill?.versionId) return
    setUpdatingSkillIds((prev) => (prev.includes(skillId) ? prev : [...prev, skillId]))
    const previous = extraSkillsCatalog
    setExtraSkillsCatalog((prev) =>
      prev.map((item) => (item.id === skillId ? { ...item, enabled } : item)),
    )
    try {
      const response = await updateSessionSkillBinding(sessionId, {
        skillId,
        versionId: skill.versionId,
        enabled,
      })
      if (!response?.success) {
        throw new Error(response?.error || '更新 Skill 失败')
      }
    } catch {
      setExtraSkillsCatalog(previous)
    } finally {
      setUpdatingSkillIds((prev) => prev.filter((id) => id !== skillId))
    }
  }, [actorState, extraSkillsCatalog, sessionId])

  return {
    enabledExtraSkills,
    canUsePrivateSkills,
    skillOptions,
    toggleSkillOption,
  }
}
