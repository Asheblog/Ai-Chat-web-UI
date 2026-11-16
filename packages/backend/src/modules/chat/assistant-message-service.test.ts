jest.mock('../../db', () => {
  const tx = {
    message: {
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      upsert: jest.fn(async () => ({ id: 99 })),
    },
    usageMetric: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({})),
    },
  }
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      message: tx.message,
      usageMetric: tx.usageMetric,
    },
  }
})

import { prisma } from '../../db'
import { persistAssistantFinalResponse } from './assistant-message-service'

const db = prisma as any

const baseUsage = { promptTokens: 10, completionTokens: 20, totalTokens: 30, contextLimit: 1000 }

const siblingRow = (id: number, variantIndex: number) => ({
  id,
  createdAt: new Date(2026, 0, id),
  variantIndex,
})

const resetMocks = () => {
  db.$transaction.mockClear()
  db.message.update.mockClear()
  db.message.findMany.mockClear()
  db.message.findUnique.mockClear()
  db.message.deleteMany.mockClear()
  db.message.upsert.mockClear()
  db.usageMetric.deleteMany.mockClear()
  db.usageMetric.create.mockClear()
}

describe('persistAssistantFinalResponse 回答版本保留', () => {
  beforeEach(resetMocks)

  it('超过历史入口曾允许的版本数时，仍保留全部版本：不删消息、不删历史用量', async () => {
    // 6 个版本，目标是最后一个；旧实现在 limit=5 时会删最旧版本 + 其 usageMetric
    db.message.findMany.mockResolvedValue([2, 3, 4, 5, 6, 7].map((id, index) => siblingRow(id, index + 1)))

    const persistedId = await persistAssistantFinalResponse({
      sessionId: 1,
      existingMessageId: 7,
      parentMessageId: 1,
      content: '第六个回答版本',
      usage: baseUsage,
      model: 'gpt',
    })

    expect(persistedId).toBe(7)
    expect(db.message.deleteMany).not.toHaveBeenCalled()
    // 只重置当前目标消息自己的用量记录，历史版本用量不得被连带删除
    for (const call of db.usageMetric.deleteMany.mock.calls) {
      expect(call[0]).toEqual({ where: { messageId: 7 } })
    }
    expect(db.usageMetric.create).toHaveBeenCalledTimes(1)
    expect(db.usageMetric.create.mock.calls[0][0].data.messageId).toBe(7)
  })

  it('版本序号按时间连续重排，目标版本保持自身 id（选择/重生成语义不变）', async () => {
    db.message.findMany.mockResolvedValue([2, 3, 4, 5, 6, 7].map((id, index) => siblingRow(id, index * 3)))

    await persistAssistantFinalResponse({
      sessionId: 1,
      existingMessageId: 7,
      parentMessageId: 1,
      content: '第六个回答版本',
      usage: baseUsage,
    })

    const updates = db.message.update.mock.calls.map((call: any[]) => call[0])
    const variantUpdates = updates.filter((arg) => 'variantIndex' in (arg.data ?? {}))
    expect(variantUpdates.map((arg) => arg.where.id)).toEqual([2, 3, 4, 5, 6, 7])
    expect(variantUpdates.map((arg) => arg.data.variantIndex)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('没有父消息时保持单版本语义（variantIndex 置空）', async () => {
    await persistAssistantFinalResponse({
      sessionId: 1,
      existingMessageId: 7,
      parentMessageId: null,
      content: '单独回答',
      usage: baseUsage,
    })

    expect(db.message.findMany).not.toHaveBeenCalled()
    expect(db.message.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { variantIndex: null, parentMessageId: null },
    })
  })
})
