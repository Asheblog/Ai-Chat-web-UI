'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listSessionSkillOptions, updateSessionSkillBinding, listSkillCatalog } from '@/features/skills/api'
import { useAuthStore } from '@/store/auth-store'
import type { SkillCatalogItem, SkillRuntimeReference } from '@/types'

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

interface ExtraSkillCatalogEntry {
  id: number
  versionId: number | null
  slug: string
  displayName: string
  description?: string | null
  enabled: boolean
  sourceLabel?: string
  licenseName?: string | null
}

function mapCatalogItems(items: SkillCatalogItem[]): ExtraSkillCatalogEntry[] {
  return items
    .map((item) => ({
      id: Number(item.id),
      versionId: item.defaultVersion?.id ?? null,
      slug: String(item.slug || '').trim(),
      displayName: String(item.displayName || item.slug || '').trim(),
      description: item.description || null,
      enabled: false,
      sourceLabel: item.sourceKey || item.sourceType || undefined,
      licenseName: item.licenseName ?? null,
    }))
    .filter((item) => item.id > 0 && item.slug.length > 0)
}

function mapSessionOptionItems(items: SkillCatalogItem[]): ExtraSkillCatalogEntry[] {
  return items
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
}

export const useSkillsSelection = (sessionId?: number | null) => {
  const [extraSkillsCatalog, setExtraSkillsCatalog] = useState<ExtraSkillCatalogEntry[]>([])
  const [updatingSkillIds, setUpdatingSkillIds] = useState<number[]>([])
  const actorState = useAuthStore((state) => state.actorState)
  const isAuthenticated = actorState === 'authenticated'
  const hasSession = Boolean(sessionId)
  const canUsePrivateSkills = isAuthenticated && hasSession

  const catalogRef = useRef(extraSkillsCatalog)
  catalogRef.current = extraSkillsCatalog

  // Session mode: load from session-options
  useEffect(() => {
    let cancelled = false
    if (!canUsePrivateSkills || !sessionId) {
      return () => {
        cancelled = true
      }
    }
    listSessionSkillOptions(sessionId)
      .then((response) => {
        if (cancelled) return
        const list = Array.isArray(response?.data?.items) ? response.data.items : []
        setExtraSkillsCatalog(mapSessionOptionItems(list))
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

  // Draft mode: authenticated but no session → load from catalog
  useEffect(() => {
    let cancelled = false
    if (!isAuthenticated || hasSession) {
      return () => {
        cancelled = true
      }
    }
    listSkillCatalog()
      .then((response) => {
        if (cancelled) return
        const list: SkillCatalogItem[] = Array.isArray(response?.data) ? response.data : []
        const userPrivateActive = list.filter(
          (item) =>
            item.visibility === 'user_private' &&
            item.status === 'active' &&
            item.defaultVersion != null,
        )
        setExtraSkillsCatalog(mapCatalogItems(userPrivateActive))
      })
      .catch(() => {
        if (!cancelled) {
          setExtraSkillsCatalog([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, hasSession])

  // Anonymous user: clear the list
  useEffect(() => {
    if (actorState !== 'authenticated') {
      setExtraSkillsCatalog([])
    }
  }, [actorState])

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
      .filter((item): item is ExtraSkillCatalogEntry & { versionId: number } =>
        item.enabled && item.versionId != null,
      )
      .map((item) => ({ skillId: item.id, versionId: item.versionId }))
  }, [extraSkillsCatalog])

  const toggleSkillOption = useCallback(async (skillId: number, enabled: boolean) => {
    // Draft mode: local toggle only, no API call
    if (!hasSession) {
      setExtraSkillsCatalog((prev) =>
        prev.map((item) => (item.id === skillId ? { ...item, enabled } : item)),
      )
      return
    }

    // Session mode: persist via API
    if (!sessionId || actorState !== 'authenticated') return
    const skill = catalogRef.current.find((item) => item.id === skillId)
    if (!skill?.versionId) return
    setUpdatingSkillIds((prev) => (prev.includes(skillId) ? prev : [...prev, skillId]))
    const previous = catalogRef.current
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
  }, [actorState, hasSession, sessionId])

  return {
    enabledExtraSkills,
    canUsePrivateSkills,
    skillOptions,
    toggleSkillOption,
  }
}
