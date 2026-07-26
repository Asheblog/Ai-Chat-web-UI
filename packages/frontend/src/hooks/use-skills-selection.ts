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
  const [loadRequested, setLoadRequested] = useState(false)
  const actorState = useAuthStore((state) => state.actorState)
  const isAuthenticated = actorState === 'authenticated'
  const hasSession = Boolean(sessionId)
  const canUsePrivateSkills = isAuthenticated && hasSession

  const catalogRef = useRef(extraSkillsCatalog)
  catalogRef.current = extraSkillsCatalog
  const inFlightRef = useRef<Promise<void> | null>(null)
  const loadedKeyRef = useRef<string | null>(null)

  const loadKey = !isAuthenticated
    ? 'anon'
    : hasSession
      ? `session:${sessionId}`
      : 'draft'

  useEffect(() => {
    setLoadRequested(false)
    loadedKeyRef.current = null
    setExtraSkillsCatalog([])
  }, [loadKey])

  useEffect(() => {
    if (actorState !== 'authenticated') {
      setExtraSkillsCatalog([])
    }
  }, [actorState])

  const toEnabledRefs = useCallback((items: ExtraSkillCatalogEntry[]): SkillRuntimeReference[] => {
    return items
      .filter((item): item is ExtraSkillCatalogEntry & { versionId: number } =>
        item.enabled && item.versionId != null,
      )
      .map((item) => ({ skillId: item.id, versionId: item.versionId }))
  }, [])

  const load = useCallback(async (): Promise<ExtraSkillCatalogEntry[]> => {
    if (!isAuthenticated) {
      setExtraSkillsCatalog([])
      return []
    }
    if (loadedKeyRef.current === loadKey && !inFlightRef.current) {
      return catalogRef.current
    }
    if (inFlightRef.current) {
      await inFlightRef.current
      return catalogRef.current
    }

    let nextCatalog: ExtraSkillCatalogEntry[] = []
    const task = (async () => {
      try {
        if (hasSession && sessionId) {
          const response = await listSessionSkillOptions(sessionId)
          const list = Array.isArray(response?.data?.items) ? response.data.items : []
          nextCatalog = mapSessionOptionItems(list)
        } else {
          const response = await listSkillCatalog()
          const list: SkillCatalogItem[] = Array.isArray(response?.data) ? response.data : []
          const userPrivateActive = list.filter(
            (item) =>
              item.visibility === 'user_private' &&
              item.status === 'active' &&
              item.defaultVersion != null,
          )
          nextCatalog = mapCatalogItems(userPrivateActive)
        }
        catalogRef.current = nextCatalog
        setExtraSkillsCatalog(nextCatalog)
        loadedKeyRef.current = loadKey
      } catch {
        nextCatalog = []
        catalogRef.current = nextCatalog
        setExtraSkillsCatalog(nextCatalog)
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = task
    await task
    return nextCatalog
  }, [hasSession, isAuthenticated, loadKey, sessionId])

  useEffect(() => {
    if (!loadRequested) return
    void load()
  }, [load, loadRequested])

  const ensureLoaded = useCallback(async () => {
    setLoadRequested(true)
    await load()
  }, [load])

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

  const enabledExtraSkills = useMemo<SkillRuntimeReference[]>(
    () => toEnabledRefs(extraSkillsCatalog),
    [extraSkillsCatalog, toEnabledRefs],
  )

  const ensureExtraSkills = useCallback(async () => {
    setLoadRequested(true)
    const catalog = await load()
    return toEnabledRefs(catalog)
  }, [load, toEnabledRefs])

  const toggleSkillOption = useCallback(async (skillId: number, enabled: boolean) => {
    if (!hasSession) {
      setExtraSkillsCatalog((prev) =>
        prev.map((item) => (item.id === skillId ? { ...item, enabled } : item)),
      )
      return
    }

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
    ensureLoaded,
    ensureExtraSkills,
  }
}
