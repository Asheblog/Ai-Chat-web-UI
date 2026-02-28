import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { MAX_SYSTEM_PROMPT_LENGTH } from '../../constants/prompt'

const MAX_TEMPLATE_TITLE_LENGTH = 120
const MAX_TEMPLATE_VARIABLES = 20
const MAX_VARIABLE_LENGTH = 64
const MAX_TEMPLATE_LIST_SIZE = 200

const templateSelect = {
  id: true,
  userId: true,
  title: true,
  content: true,
  variablesJson: true,
  pinnedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PromptTemplateSelect

type PromptTemplateRecord = Prisma.PromptTemplateGetPayload<{ select: typeof templateSelect }>

export interface PromptTemplateDetail {
  id: number
  userId: number
  title: string
  content: string
  variables: string[]
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
}

export class PromptTemplateServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'PromptTemplateServiceError'
    this.statusCode = statusCode
  }
}

export interface PromptTemplateServiceDeps {
  prisma?: PrismaClient
  logger?: Pick<typeof console, 'error' | 'warn'>
}

const normalizeVariables = (variables?: string[]): string[] => {
  if (!Array.isArray(variables) || variables.length === 0) return []
  const unique = new Set<string>()
  for (const raw of variables) {
    if (typeof raw !== 'string') continue
    const normalized = raw.trim().replace(/[{}]/g, '')
    if (!normalized) continue
    unique.add(normalized.slice(0, MAX_VARIABLE_LENGTH))
    if (unique.size >= MAX_TEMPLATE_VARIABLES) break
  }
  return Array.from(unique)
}

const parseVariables = (variablesJson: string | null | undefined): string[] => {
  if (!variablesJson) return []
  try {
    const parsed = JSON.parse(variablesJson)
    if (!Array.isArray(parsed)) return []
    return normalizeVariables(parsed)
  } catch {
    return []
  }
}

const stringifyVariables = (variables?: string[]) => JSON.stringify(normalizeVariables(variables))

const normalizeTemplateTitle = (title: string) => {
  const normalized = title.trim()
  if (!normalized) {
    throw new PromptTemplateServiceError('Template title is required')
  }
  if (normalized.length > MAX_TEMPLATE_TITLE_LENGTH) {
    throw new PromptTemplateServiceError(`Template title cannot exceed ${MAX_TEMPLATE_TITLE_LENGTH} characters`)
  }
  return normalized
}

const normalizeTemplateContent = (content: string) => {
  const normalized = content.trim()
  if (!normalized) {
    throw new PromptTemplateServiceError('Template content is required')
  }
  if (normalized.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new PromptTemplateServiceError(`Template content cannot exceed ${MAX_SYSTEM_PROMPT_LENGTH} characters`)
  }
  return normalized
}

const mapTemplate = (record: PromptTemplateRecord): PromptTemplateDetail => ({
  id: record.id,
  userId: record.userId,
  title: record.title,
  content: record.content,
  variables: parseVariables(record.variablesJson),
  pinnedAt: record.pinnedAt ? record.pinnedAt.toISOString() : null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})

export class PromptTemplateService {
  private prisma: PrismaClient
  private logger: Pick<typeof console, 'error' | 'warn'>

  constructor(deps: PromptTemplateServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.logger = deps.logger ?? console
  }

  async listTemplates(userId: number): Promise<PromptTemplateDetail[]> {
    const records = await this.prisma.promptTemplate.findMany({
      where: { userId },
      select: templateSelect,
      orderBy: [{ pinnedAt: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_TEMPLATE_LIST_SIZE,
    })
    return records.map(mapTemplate)
  }

  async createTemplate(
    userId: number,
    payload: {
      title: string
      content: string
      variables?: string[]
      pinned?: boolean
    },
  ): Promise<PromptTemplateDetail> {
    const title = normalizeTemplateTitle(payload.title)
    const content = normalizeTemplateContent(payload.content)
    const variablesJson = stringifyVariables(payload.variables)
    const created = await this.prisma.promptTemplate.create({
      data: {
        userId,
        title,
        content,
        variablesJson,
        pinnedAt: payload.pinned ? new Date() : null,
      },
      select: templateSelect,
    })
    return mapTemplate(created)
  }

  async updateTemplate(
    userId: number,
    templateId: number,
    payload: {
      title?: string
      content?: string
      variables?: string[]
      pinned?: boolean
    },
  ): Promise<PromptTemplateDetail> {
    const existing = await this.prisma.promptTemplate.findFirst({
      where: { id: templateId, userId },
      select: { id: true },
    })
    if (!existing) {
      throw new PromptTemplateServiceError('Prompt template not found', 404)
    }

    const updates: Prisma.PromptTemplateUpdateInput = {}
    if (typeof payload.title === 'string') {
      updates.title = normalizeTemplateTitle(payload.title)
    }
    if (typeof payload.content === 'string') {
      updates.content = normalizeTemplateContent(payload.content)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'variables')) {
      updates.variablesJson = stringifyVariables(payload.variables)
    }
    if (typeof payload.pinned === 'boolean') {
      updates.pinnedAt = payload.pinned ? new Date() : null
    }

    if (Object.keys(updates).length === 0) {
      throw new PromptTemplateServiceError('No valid updates provided')
    }

    try {
      const updated = await this.prisma.promptTemplate.update({
        where: { id: templateId },
        data: updates,
        select: templateSelect,
      })
      return mapTemplate(updated)
    } catch (error) {
      this.logger.error?.('[PromptTemplateService] failed to update template', {
        templateId,
        userId,
        error,
      })
      throw new PromptTemplateServiceError('Failed to update prompt template', 500)
    }
  }

  async deleteTemplate(userId: number, templateId: number): Promise<void> {
    const deleted = await this.prisma.promptTemplate.deleteMany({
      where: { id: templateId, userId },
    })
    if (deleted.count === 0) {
      throw new PromptTemplateServiceError('Prompt template not found', 404)
    }
  }
}

let promptTemplateService = new PromptTemplateService()

export const setPromptTemplateService = (service: PromptTemplateService) => {
  promptTemplateService = service
}

export { promptTemplateService }
