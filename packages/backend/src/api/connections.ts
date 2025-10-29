import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { prisma } from '../db'
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import { AuthUtils } from '../utils/auth'
import { verifyConnection } from '../utils/providers'

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
})

connections.get('/', authMiddleware, adminOnlyMiddleware, async (c) => {
  const rows = await prisma.connection.findMany({ where: { ownerUserId: null } })
  return c.json<ApiResponse>({ success: true, data: rows })
})

connections.post('/', authMiddleware, adminOnlyMiddleware, zValidator('json', connectionSchema), async (c) => {
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
      connectionType: body.connectionType || 'external',
    },
  })
  return c.json<ApiResponse>({ success: true, data: row, message: 'Connection created' })
})

connections.put('/:id', authMiddleware, adminOnlyMiddleware, zValidator('json', connectionSchema.partial()), async (c) => {
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
  if (body.connectionType) updates.connectionType = body.connectionType
  const row = await prisma.connection.update({ where: { id }, data: updates })
  return c.json<ApiResponse>({ success: true, data: row, message: 'Connection updated' })
})

connections.delete('/:id', authMiddleware, adminOnlyMiddleware, async (c) => {
  const id = parseInt(c.req.param('id'))
  await prisma.connection.delete({ where: { id } })
  return c.json<ApiResponse>({ success: true, message: 'Connection deleted' })
})

connections.post('/verify', authMiddleware, zValidator('json', connectionSchema), async (c) => {
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
    })
    return c.json<ApiResponse>({ success: true, message: 'Connection verified' })
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: e?.message || 'Verify failed' }, 400)
  }
})

// 用户直连
connections.get('/user', authMiddleware, async (c) => {
  const user = c.get('user')
  const rows = await prisma.connection.findMany({ where: { ownerUserId: user.id } })
  return c.json<ApiResponse>({ success: true, data: rows })
})

connections.post('/user', authMiddleware, zValidator('json', connectionSchema), async (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')
  const encKey = body.authType === 'bearer' && body.apiKey ? AuthUtils.encryptApiKey(body.apiKey) : ''
  const row = await prisma.connection.create({
    data: {
      ownerUserId: user.id,
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
      connectionType: body.connectionType || 'external',
    },
  })
  return c.json<ApiResponse>({ success: true, data: row, message: 'Connection created' })
})

connections.put('/user/:id', authMiddleware, zValidator('json', connectionSchema.partial()), async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const exists = await prisma.connection.findFirst({ where: { id, ownerUserId: user.id } })
  if (!exists) return c.json<ApiResponse>({ success: false, error: 'Not found' }, 404)
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
  if (body.connectionType) updates.connectionType = body.connectionType
  const row = await prisma.connection.update({ where: { id }, data: updates })
  return c.json<ApiResponse>({ success: true, data: row, message: 'Connection updated' })
})

connections.delete('/user/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const exists = await prisma.connection.findFirst({ where: { id, ownerUserId: user.id } })
  if (!exists) return c.json<ApiResponse>({ success: false, error: 'Not found' }, 404)
  await prisma.connection.delete({ where: { id } })
  return c.json<ApiResponse>({ success: true, message: 'Connection deleted' })
})

export default connections
