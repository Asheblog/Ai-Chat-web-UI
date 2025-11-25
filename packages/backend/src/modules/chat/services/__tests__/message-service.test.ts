import {
  setMessageServiceDeps,
  resetMessageServiceDeps,
  createUserMessageWithQuota,
} from '../message-service'
import type { Actor } from '../../../../types'

const mockTx = () => {
  const messageStore: any[] = []
  return {
    message: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => {
        const msg = { id: 1, ...data, createdAt: new Date() }
        messageStore.push(msg)
        return msg
      }),
    },
  }
}

const buildPrisma = () => {
  const tx = mockTx()
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  }
  return { prisma, tx }
}

describe('message-service injection', () => {
  const actor: Actor = {
    type: 'user',
    id: 1,
    role: 'USER',
    status: 'ACTIVE',
    username: 'tester',
    identifier: 'user:1',
  }

  const defaultDeps = {
    consumeActorQuota: jest.fn(),
    inspectActorQuota: jest.fn(),
    persistChatImages: jest.fn(),
  }
  const VALID_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgSppZQAAAABJRU5ErkJggg=='

  afterEach(() => {
    resetMessageServiceDeps()
  })

  it('uses injected prisma and quota functions', async () => {
    const { prisma, tx } = buildPrisma()
    const consumeActorQuota = jest.fn().mockResolvedValue({ success: true, snapshot: { remaining: 1 } })
    const inspectActorQuota = jest.fn().mockResolvedValue({ remaining: 1 })

    setMessageServiceDeps({
      prisma,
      consumeActorQuota,
      inspectActorQuota,
      persistChatImages: defaultDeps.persistChatImages,
    })

    const result = await createUserMessageWithQuota({
      actor,
      sessionId: 10,
      content: 'hi',
    })

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(tx.message.create).toHaveBeenCalled()
    expect(consumeActorQuota).toHaveBeenCalled()
    expect(result.userMessage.content).toBe('hi')
  })

  it('persists images using injected handler when not reused', async () => {
    const { prisma } = buildPrisma()
    const persistChatImages = jest.fn().mockResolvedValue(undefined)
    setMessageServiceDeps({
      prisma,
      consumeActorQuota: jest.fn().mockResolvedValue({ success: true, snapshot: { remaining: 1 } }),
      inspectActorQuota: jest.fn(),
      persistChatImages,
    })

    await createUserMessageWithQuota({
      actor,
      sessionId: 2,
      content: 'hi',
      images: [{ data: VALID_IMAGE_BASE64, mime: 'image/png' }],
    })

    expect(persistChatImages).toHaveBeenCalled()
  })
})
