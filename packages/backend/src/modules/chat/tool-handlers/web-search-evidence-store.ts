/**
 * 同一任务内的搜索正文复用。
 *
 * web_search 已经取得的正文（含自动阅读得到的正文）可以交给同任务的 read_url，
 * 避免重复抓取；复用只在「同一 session + 同一条助手消息」内有效，有 TTL 与容量上限。
 *
 * 身份缺失时一律禁用：不使用 anonymous/none 之类共享占位键，
 * 否则不同任务之间会互相复用正文。摘要、highlights、以及提供方声明已截断的正文都不入库。
 */

import type { WebSearchHit } from '../../../utils/web-search'
import { normalizeSearchUrl } from '../../../utils/web-search'

export interface SearchEvidenceEntry {
  content: string
  /** 正文种类：结构化正文不能按 article 复用，需要原样保留。 */
  contentKind: 'article' | 'structured'
  /** 实际提供正文的一方：搜索引擎名或读取引擎名。 */
  source: string
  fetchedAt?: string
  storedAt: number
  title?: string
}

const DEFAULT_TTL_MS = 10 * 60 * 1000
const MAX_TASKS = 32
const MAX_ENTRIES_PER_TASK = 24
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

interface StoredEvidence extends SearchEvidenceEntry {
  bytes: number
}

interface EvidenceWrite {
  url: string
  content: string
  contentKind: 'article' | 'structured'
  source: string
  title?: string
  fetchedAt?: string
}

const store = new Map<string, Map<string, StoredEvidence>>()
let totalBytes = 0

/**
 * 任务键必须是「本 session + 本条助手消息」。缺任一有效身份时返回 null：
 * 宁可禁用复用，也不能用共享占位把不同任务串在一起。
 */
export const buildSearchEvidenceTaskKey = (context: {
  sessionId?: number | null
  messageId?: number | null
}): string | null => {
  const sessionId = typeof context.sessionId === 'number' ? context.sessionId : Number.NaN
  const messageId = typeof context.messageId === 'number' ? context.messageId : Number.NaN
  if (!Number.isFinite(sessionId) || !Number.isFinite(messageId)) return null
  if (sessionId <= 0 || messageId <= 0) return null
  return sessionId + ':' + messageId
}

const urlKey = (url: string): string => normalizeSearchUrl(url) || (url || '').trim()

const pruneExpired = (now: number, ttlMs: number): void => {
  for (const [taskKey, entries] of store) {
    for (const [key, entry] of entries) {
      if (now - entry.storedAt > ttlMs) {
        totalBytes -= entry.bytes
        entries.delete(key)
      }
    }
    if (entries.size === 0) store.delete(taskKey)
  }
}

/** 写入一条可复用正文：同键覆盖只计一次字节数。 */
const writeEntry = (taskKey: string, entry: EvidenceWrite, now: number): void => {
  const content = (entry.content || '').trim()
  if (!content) return
  const key = urlKey(entry.url)
  if (!key) return
  let entries = store.get(taskKey)
  if (!entries) {
    entries = new Map()
    store.set(taskKey, entries)
  }
  const previous = entries.get(key)
  if (previous) totalBytes -= previous.bytes
  const bytes = Buffer.byteLength(content, 'utf8')
  entries.set(key, {
    content,
    contentKind: entry.contentKind,
    source: entry.source,
    ...(entry.fetchedAt ? { fetchedAt: entry.fetchedAt } : {}),
    storedAt: now,
    ...(entry.title ? { title: entry.title } : {}),
    bytes,
  })
  totalBytes += bytes
}

/** 每个任务只保留最近的若干条，总量与任务数也设上限。 */
const enforceBounds = (): void => {
  for (const [taskKey, entries] of store) {
    while (entries.size > MAX_ENTRIES_PER_TASK) {
      const oldest = Array.from(entries.entries()).sort((a, b) => a[1].storedAt - b[1].storedAt)[0]
      if (!oldest) break
      totalBytes -= oldest[1].bytes
      entries.delete(oldest[0])
    }
    if (entries.size === 0) store.delete(taskKey)
  }
  while (totalBytes > MAX_TOTAL_BYTES && store.size > 0) {
    const oldest = Array.from(store.entries())
      .flatMap(([task, items]) => Array.from(items.entries()).map(([key, entry]) => ({ task, key, entry })))
      .sort((a, b) => a.entry.storedAt - b.entry.storedAt)[0]
    if (!oldest) break
    totalBytes -= oldest.entry.bytes
    store.get(oldest.task)?.delete(oldest.key)
    if (store.get(oldest.task)?.size === 0) store.delete(oldest.task)
  }
  while (store.size > MAX_TASKS) {
    const oldestTask = Array.from(store.entries()).sort((a, b) => {
      const aAt = Math.min(...Array.from(a[1].values()).map((item) => item.storedAt))
      const bAt = Math.min(...Array.from(b[1].values()).map((item) => item.storedAt))
      return aAt - bAt
    })[0]
    if (!oldestTask) break
    for (const entry of oldestTask[1].values()) totalBytes -= entry.bytes
    store.delete(oldestTask[0])
  }
}

/** 只记录可当正文复用的命中：article 且提供方没有声明截断。 */
export const recordSearchEvidence = (taskKey: string | null, hits: WebSearchHit[]): void => {
  if (!taskKey) return
  const now = Date.now()
  pruneExpired(now, DEFAULT_TTL_MS)
  for (const hit of hits) {
    if (hit.contentKind !== 'article') continue
    if (hit.contentMetadata?.truncated) continue
    writeEntry(
      taskKey,
      {
        url: hit.url,
        content: hit.content || '',
        contentKind: 'article',
        source: hit.contentSource || hit.engine || hit.sourceEngines?.[0] || 'search',
        ...(hit.title ? { title: hit.title } : {}),
      },
      now,
    )
  }
  enforceBounds()
}

/**
 * 自动阅读得到的正文同样可复用：来源保留真实读取引擎（native/browser/crawler…），
 * 不写回成 'search'；截断正文不入库。
 */
export const recordReadEvidence = (
  taskKey: string | null,
  items: Array<{
    url: string
    content?: string
    evidenceKind: 'article' | 'structured' | 'summary' | 'none'
    contentSource?: string
    title?: string
    fetchedAt?: string
    truncated?: boolean
  }>,
): void => {
  if (!taskKey) return
  const now = Date.now()
  pruneExpired(now, DEFAULT_TTL_MS)
  for (const item of items) {
    if (item.evidenceKind !== 'article' && item.evidenceKind !== 'structured') continue
    if (item.truncated) continue
    if (!item.content || !item.content.trim()) continue
    writeEntry(
      taskKey,
      {
        url: item.url,
        content: item.content,
        contentKind: item.evidenceKind === 'structured' ? 'structured' : 'article',
        source: item.contentSource || 'read',
        ...(item.title ? { title: item.title } : {}),
        ...(item.fetchedAt ? { fetchedAt: item.fetchedAt } : {}),
      },
      now,
    )
  }
  enforceBounds()
}

export const lookupSearchEvidence = (
  taskKey: string | null,
  url: string,
  options: { now?: number; ttlMs?: number } = {},
): SearchEvidenceEntry | undefined => {
  if (!taskKey) return undefined
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  pruneExpired(now, ttlMs)
  const entry = store.get(taskKey)?.get(urlKey(url))
  if (!entry) return undefined
  return {
    content: entry.content,
    contentKind: entry.contentKind,
    source: entry.source,
    ...(entry.fetchedAt ? { fetchedAt: entry.fetchedAt } : {}),
    storedAt: entry.storedAt,
    ...(entry.title ? { title: entry.title } : {}),
  }
}

export const clearSearchEvidenceStore = (): void => {
  store.clear()
  totalBytes = 0
}
