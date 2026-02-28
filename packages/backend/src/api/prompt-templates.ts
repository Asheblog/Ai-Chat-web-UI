import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { actorMiddleware, requireUserActor } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import {
  promptTemplateService,
  PromptTemplateService,
  PromptTemplateServiceError,
} from '../services/prompt-templates'
import { MAX_SYSTEM_PROMPT_LENGTH } from '../constants/prompt'

const MAX_TITLE_LENGTH = 120
const MAX_VARIABLES = 20
const MAX_VARIABLE_LENGTH = 64

const templateVariablesSchema = z.array(z.string().trim().min(1).max(MAX_VARIABLE_LENGTH)).max(MAX_VARIABLES)

const createTemplateSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  content: z.string().trim().min(1).max(MAX_SYSTEM_PROMPT_LENGTH),
  variables: templateVariablesSchema.optional(),
  pinned: z.boolean().optional(),
})

const updateTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
    content: z.string().trim().min(1).max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
    variables: templateVariablesSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export interface PromptTemplatesApiDeps {
  promptTemplateService?: PromptTemplateService
}

const parseTemplateId = (raw: string): number | null => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

const handleError = (c: any, error: unknown, fallback: string) => {
  if (error instanceof PromptTemplateServiceError) {
    return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
  }
  console.error('[prompt-templates] unexpected error', error)
  return c.json<ApiResponse>({ success: false, error: fallback }, 500)
}

export const createPromptTemplatesApi = (deps: PromptTemplatesApiDeps = {}) => {
  const svc = deps.promptTemplateService ?? promptTemplateService
  const router = new Hono()

  router.get('/', actorMiddleware, requireUserActor, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      if (actor.type !== 'user') {
        return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
      }
      const templates = await svc.listTemplates(actor.id)
      return c.json<ApiResponse<{ templates: typeof templates }>>({
        success: true,
        data: { templates },
      })
    } catch (error) {
      return handleError(c, error, 'Failed to fetch prompt templates')
    }
  })

  router.post(
    '/',
    actorMiddleware,
    requireUserActor,
    zValidator('json', createTemplateSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        if (actor.type !== 'user') {
          return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
        }
        const payload = c.req.valid('json')
        const created = await svc.createTemplate(actor.id, payload)
        return c.json<ApiResponse<typeof created>>({ success: true, data: created })
      } catch (error) {
        return handleError(c, error, 'Failed to create prompt template')
      }
    },
  )

  router.put(
    '/:id',
    actorMiddleware,
    requireUserActor,
    zValidator('json', updateTemplateSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        if (actor.type !== 'user') {
          return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
        }
        const templateId = parseTemplateId(c.req.param('id'))
        if (!templateId) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid template id' }, 400)
        }
        const payload = c.req.valid('json')
        const updated = await svc.updateTemplate(actor.id, templateId, payload)
        return c.json<ApiResponse<typeof updated>>({ success: true, data: updated })
      } catch (error) {
        return handleError(c, error, 'Failed to update prompt template')
      }
    },
  )

  router.delete('/:id', actorMiddleware, requireUserActor, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      if (actor.type !== 'user') {
        return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
      }
      const templateId = parseTemplateId(c.req.param('id'))
      if (!templateId) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid template id' }, 400)
      }
      await svc.deleteTemplate(actor.id, templateId)
      return c.json<ApiResponse>({ success: true })
    } catch (error) {
      return handleError(c, error, 'Failed to delete prompt template')
    }
  })

  return router
}

export default createPromptTemplatesApi()
