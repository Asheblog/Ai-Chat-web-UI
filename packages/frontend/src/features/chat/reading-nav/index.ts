export type TurnTocEntry = {
  key: string
  messageId: number | string
  label: string
}

export type ReadingAnchor = {
  messageKey: string
}

export type ReadingAnchorStore = Record<number, ReadingAnchor>

export type TurnMetaLike = {
  id?: number | string
  stableKey: string
  role: 'user' | 'assistant' | 'compressedGroup' | string
  images?: string[] | null
}

export type TurnBodyLike = {
  content?: string | null
}

export const TURN_LABEL_MAX_CHARS = 20

export const truncateTurnLabel = (text: string, maxChars: number = TURN_LABEL_MAX_CHARS): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}…`
}

const resolveTurnLabel = (meta: TurnMetaLike, body: TurnBodyLike | undefined): string => {
  if (meta.role === 'compressedGroup') return '已压缩对话'
  const content = typeof body?.content === 'string' ? body.content.replace(/\s+/g, ' ').trim() : ''
  if (content) return truncateTurnLabel(content)
  if (Array.isArray(meta.images) && meta.images.length > 0) return '图片消息'
  return '空消息'
}

export const buildTurnTocEntries = (
  metas: TurnMetaLike[],
  bodies: Record<string, TurnBodyLike | undefined>,
): TurnTocEntry[] => {
  const entries: TurnTocEntry[] = []
  for (const meta of metas) {
    if (meta.role !== 'user' && meta.role !== 'compressedGroup') continue
    const id = meta.id ?? meta.stableKey
    const bodyKey = typeof id === 'string' || typeof id === 'number' ? String(id) : meta.stableKey
    entries.push({
      key: meta.stableKey,
      messageId: id,
      label: resolveTurnLabel(meta, bodies[bodyKey]),
    })
  }
  return entries
}

export const shouldShowTurnToc = (
  entries: TurnTocEntry[],
  options: { scrollable: boolean },
): boolean => {
  if (entries.length >= 3) return true
  return options.scrollable && entries.length >= 2
}

export const buildTurnOwnership = (metas: Array<Pick<TurnMetaLike, 'stableKey' | 'role'>>): Map<string, string> => {
  const ownership = new Map<string, string>()
  let currentTurnKey: string | null = null
  for (const meta of metas) {
    if (meta.role === 'user' || meta.role === 'compressedGroup') {
      currentTurnKey = meta.stableKey
      ownership.set(meta.stableKey, meta.stableKey)
      continue
    }
    if (currentTurnKey) {
      ownership.set(meta.stableKey, currentTurnKey)
    }
  }
  return ownership
}

export type MessagePosition = {
  key: string
  top: number
  bottom: number
}

export type ViewportProbe = {
  viewportTop: number
  viewportHeight: number
  /** 0–1, default 1/3 from top of viewport */
  fraction?: number
}

export const resolveActiveTurnKey = (
  entries: TurnTocEntry[],
  ownership: Map<string, string>,
  positions: MessagePosition[],
  probe: ViewportProbe,
): string | null => {
  if (entries.length === 0) return null
  const fraction = probe.fraction ?? 1 / 3
  const probeY = probe.viewportTop + probe.viewportHeight * fraction

  let bestTurn: string | null = null
  let bestTop = Number.NEGATIVE_INFINITY

  for (const pos of positions) {
    const turnKey = ownership.get(pos.key)
    if (!turnKey) continue
    // 取探测线之上（含穿过探测线）的最后一条消息所属轮次
    if (pos.top <= probeY && pos.top >= bestTop) {
      bestTop = pos.top
      bestTurn = turnKey
    }
  }

  return bestTurn ?? entries[0]?.key ?? null
}

export const parseReadingAnchorStore = (raw: string | null | undefined): ReadingAnchorStore => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const next: ReadingAnchorStore = {}
    for (const [key, value] of Object.entries(parsed)) {
      const sessionId = Number.parseInt(key, 10)
      if (!Number.isFinite(sessionId)) continue
      if (!value || typeof value !== 'object') continue
      const messageKey = (value as { messageKey?: unknown }).messageKey
      if (typeof messageKey !== 'string' || messageKey.trim().length === 0) continue
      next[sessionId] = { messageKey: messageKey.trim() }
    }
    return next
  } catch {
    return {}
  }
}

export const serializeReadingAnchorStore = (store: ReadingAnchorStore): string => {
  const payload: Record<string, ReadingAnchor> = {}
  for (const [sessionId, anchor] of Object.entries(store)) {
    if (!anchor?.messageKey) continue
    payload[sessionId] = { messageKey: anchor.messageKey }
  }
  return JSON.stringify(payload)
}

export const READING_ANCHOR_STORAGE_KEY = 'aichat:chat-reading-anchor'
