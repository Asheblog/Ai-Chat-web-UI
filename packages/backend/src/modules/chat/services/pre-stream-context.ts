import type { PrismaClient } from '@prisma/client'

export type SystemSettingsMap = Record<string, string>

export type HistoryMessageRow = {
  id: number
  role: string
  content: string
  createdAt: Date
  messageGroupId: number | null
}

export type HistoryGroupRow = {
  id: number
  summary: string
  metadataJson?: string | null
}

export type PreStreamHistorySnapshot = {
  messages: HistoryMessageRow[]
  groups: HistoryGroupRow[]
}

export type PreStreamTurnContext = {
  systemSettings: SystemSettingsMap
  history: PreStreamHistorySnapshot
}

export function rowsToSystemSettings(
  rows: Array<{ key: string; value: string | null }>,
): SystemSettingsMap {
  return rows.reduce<SystemSettingsMap>((acc, row) => {
    acc[row.key] = row.value ?? ''
    return acc
  }, {})
}

export async function loadSystemSettingsMap(
  prisma: PrismaClient,
): Promise<SystemSettingsMap> {
  const rows = await prisma.systemSetting.findMany({
    select: { key: true, value: true },
  })
  return rowsToSystemSettings(rows)
}

export async function loadPreStreamHistorySnapshot(
  prisma: PrismaClient,
  params: {
    sessionId: number
    historyUpperBound?: Date | null
  },
): Promise<PreStreamHistorySnapshot> {
  const messageWhere: Record<string, unknown> = {
    sessionId: params.sessionId,
    ...(params.historyUpperBound ? { createdAt: { lte: params.historyUpperBound } } : {}),
  }

  const messages = (await (prisma as any).message.findMany({
    where: messageWhere,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      messageGroupId: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })) as HistoryMessageRow[]

  const groupedIds = Array.from(
    new Set(
      messages
        .map((item) => (typeof item.messageGroupId === 'number' ? item.messageGroupId : null))
        .filter((id): id is number => id != null),
    ),
  )

  const groups =
    groupedIds.length > 0
      ? ((await (prisma as any).messageGroup.findMany({
          where: {
            id: { in: groupedIds },
            cancelledAt: null,
          },
          select: {
            id: true,
            summary: true,
            metadataJson: true,
          },
        })) as HistoryGroupRow[])
      : []

  return { messages, groups }
}

export async function loadPreStreamTurnContext(
  prisma: PrismaClient,
  params: {
    sessionId: number
    historyUpperBound?: Date | null
  },
): Promise<PreStreamTurnContext> {
  const [systemSettings, history] = await Promise.all([
    loadSystemSettingsMap(prisma),
    loadPreStreamHistorySnapshot(prisma, params),
  ])
  return { systemSettings, history }
}

export function ungroupedMessagesFromSnapshot(
  history: PreStreamHistorySnapshot,
): Array<{ id: number; role: string; content: string; createdAt: Date }> {
  return history.messages
    .filter((msg) => msg.messageGroupId == null)
    .map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    }))
}
