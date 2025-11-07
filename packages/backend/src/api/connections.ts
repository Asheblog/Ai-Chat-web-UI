import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { prisma } from '../db'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import { AuthUtils } from '../utils/auth'
import { verifyConnection } from '../utils/providers'
import { refreshModelCatalogForConnection } from '../utils/model-catalog'
import { BackendLogger as log } from '../utils/logger'
import { normalizeCapabilityFlags } from '../utils/capabilities'

const capabilitySchema = z.object({
  vision: z.boolean().optional(),
  file_upload: z.boolean().optional(),
  web_search: z.boolean().optional(),
  image_generation: z.boolean().optional(),
  code_interpreter: z.boolean().optional(),
})

const connections = new Hono()

const connectionSchema = z.object({
  provider: z.enum(['openai','azure_openai','ollama','google_genai']),
  baseUrl: z.string().url(),
  enable: z.boolean().optional().default(true),
  authType: z.enum(['bearer','none','session','system_oauth','microsoft_entra_id']).optional().default('bearer'),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  azureApiVersion: z.string().optional(),
  prefixId: z.string().optional(),
  tags: z.array(z.object({ name: z.string() })).optional(),
  modelIds: z.array(z.string()).optional(),
  connectionType: z.enum(['external','local']).optional(),
  defaultCapabilities: capabilitySchema.partial().optional(),
})

connections.use('*', actorMiddleware)

connections.get('/', requireUserActor, adminOnlyMiddleware, async (c) => {
  const rows = await prisma.connection.findMany({ where: { ownerUserId: null } })
  return c.json<ApiResponse>({ success: true, data: rows })
})

connections.post('/', requireUserActor, adminOnlyMiddleware, zValidator('json', connectionSchema), async (c) => {
  const body = c.req.valid('json')
  const encKey = body.authType === 'bearer' && body.apiKey ? AuthUtils.encryptApiKey(body.apiKey) : ''
  const row = await prisma.connection.create({
    data: {
      ownerUserId: null,
      provider: body.provider,
      baseUrl: body.baseUrl.replace(/\/$/, ''),
      enable: body.enable ?? true,
      authType: body.authType ?? 'bearer',
      apiKey: encKey,
      headersJson: body.headers ? JSON.stringify(body.headers) : '',
      azureApiVersion: body.azureApiVersion,
      prefixId: body.prefixId,
      tagsJson: JSON.stringify(body.tags || []),
      modelIdsJson: JSON.stringify(body.modelIds || []),
      defaultCapabilitiesJson: JSON.stringify(normalizeCapabilityFlags(body.defaultCapabilities) || {}),
      connectionType: body.connectionType || 'external',
    },
  })
  try {
    await refreshModelCatalogForConnection(row)
  } catch (error) {
    log.warn('新增系统连接后刷新模型目录失败', { id: row.id, error })
  }
  return c.json<ApiResponse>({ success: true, data: row, message: 'Connection created' })
})

connections.put('/:id', requireUserActor, adminOnlyMiddleware, zValidator('json', connectionSchema.partial()), async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = c.req.valid('json')
  const updates: any = {}
  if (body.provider) updates.provider = body.provider
  if (body.baseUrl) updates.baseUrl = body.baseUrl.replace(/\/$/, '')
  if (typeof body.enable === 'boolean') updates.enable = body.enable
  if (body.authType) updates.authType = body.authType
  if (body.apiKey != null) updates.apiKey = body.authType === 'bearer' && body.apiKey ? AuthUtils.encryptApiKey(body.apiKey) : ''
  if (body.headers) updates.headersJson = JSON.stringify(body.headers)
  if (body.azureApiVersion != null) updates.azureApiVersion = body.azureApiVersion
  if (body.prefixId != null) updates.prefixId = body.prefixId
  if (body.tags) updates.tagsJson = JSON.stringify(body.tags)
  if (body.modelIds) updates.modelIdsJson = JSON.stringify(body.modelIds)
  if (body.defaultCapabilities) updates.defaultCapabilitiesJson = JSON.stringify(normalizeCapabilityFlags(body.defaultCapabilities) || {})
  if (body.connectionType) updates.connectionType = body.connectionType
  updates.ownerUserId = null
  const row = await prisma.connection.update({ where: { id }, data: updates })
  try {
    await refreshModelCatalogForConnection(row)
  } catch (error) {
    log.warn('更新系统连接后刷新模型目录失败', { id: row.id, error })
  }
  return c.json<ApiResponse>({ success: true, data: row, message: 'Connection updated' })
})

connections.delete('/:id', requireUserActor, adminOnlyMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  await prisma.connection.delete({ where: { id } })
  await prisma.modelCatalog.deleteMany({ where: { connectionId: id } })
  return c.json<ApiResponse>({ success: true, message: 'Connection deleted' })
})

connections.post('/verify', requireUserActor, zValidator('json', connectionSchema), async (c) => {
  const body = c.req.valid('json')
  try {
    await verifyConnection({
      provider: body.provider,
      baseUrl: body.baseUrl,
      enable: body.enable ?? true,
      authType: body.authType ?? 'bearer',
      apiKey: body.apiKey,
      headers: body.headers,
      azureApiVersion: body.azureApiVersion,
      prefixId: body.prefixId,
      tags: body.tags,
      modelIds: body.modelIds,
      connectionType: body.connectionType,
      defaultCapabilities: normalizeCapabilityFlags(body.defaultCapabilities),
    })
    return c.json<ApiResponse>({ success: true, message: 'Connection verified' })
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e?.message || 'Verify failed' }, 400)
  }
})

export default connections
