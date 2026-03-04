jest.mock('../../db', () => ({
  prisma: {},
}))

import type { Actor } from '../../types'
import { BattleService } from './battle-service'

const ACTOR: Actor = {
  type: 'user',
  id: 1,
  username: 'tester',
  role: 'ADMIN',
  status: 'ACTIVE',
  identifier: 'user:1',
}

const createService = (overrides?: {
  prisma?: any
  modelResolver?: any
  executor?: any
  imageService?: any
}) => {
  const prisma = overrides?.prisma ?? {}
  const modelResolver = overrides?.modelResolver ?? {
    resolveModelForRequest: jest.fn(),
  }
  const executor = overrides?.executor ?? {
    judgeAnswer: jest.fn(),
  }
  const imageService = overrides?.imageService ?? {
    loadImages: jest.fn(async () => []),
    resolveImageUrls: jest.fn((paths: string[]) => paths),
  }

  const service = new BattleService({
    prisma: prisma as any,
    modelResolver: modelResolver as any,
    executor: executor as any,
    imageService: imageService as any,
    retentionCleanupService: {
      triggerIfDue: jest.fn(async () => {}),
    } as any,
  })

  return { service, prisma, modelResolver, executor, imageService }
}

describe('BattleService - single model multi question', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejudgeWithNewAnswer: single 模式直接拒绝（引导使用重试裁判）', async () => {
    const prisma = {
      battleRun: {
        findFirst: jest.fn(async () => ({
          id: 7,
          mode: 'single_model_multi_question',
          userId: 1,
        })),
      },
    }
    const { service } = createService({ prisma })

    await expect(
      service.rejudgeWithNewAnswer(ACTOR, {
        runId: 7,
        expectedAnswer: { text: 'new answer' },
      }),
    ).rejects.toThrow('单模型多问题模式暂不支持改答案重判，请使用重试裁判')
    expect(prisma.battleRun.findFirst).toHaveBeenCalledTimes(1)
  })

  it('retryJudgeForRun: single 模式按 questionIndex 读取每题 prompt/answer 进行评测', async () => {
    const runConfig = {
      mode: 'single_model_multi_question',
      questions: [
        {
          questionIndex: 1,
          prompt: { text: '题目-1', images: [] },
          expectedAnswer: { text: '答案-1', images: [] },
          runsPerQuestion: 2,
          passK: 1,
        },
        {
          questionIndex: 2,
          prompt: { text: '题目-2', images: [] },
          expectedAnswer: { text: '答案-2', images: [] },
          runsPerQuestion: 2,
          passK: 1,
        },
      ],
    }

    const runRecord = {
      id: 9,
      mode: 'single_model_multi_question',
      configJson: JSON.stringify(runConfig),
      prompt: 'fallback-prompt',
      expectedAnswer: 'fallback-answer',
      promptImagesJson: '[]',
      expectedAnswerImagesJson: '[]',
      judgeModelId: 'judge-model',
      judgeConnectionId: 101,
      judgeRawId: 'judge-raw',
      judgeThreshold: 0.75,
      runsPerModel: 1,
      passK: 1,
      status: 'running',
      userId: 1,
    }

    const candidates = [
      {
        id: 101,
        battleRunId: 9,
        questionIndex: 1,
        questionId: null,
        questionTitle: 'Q1',
        modelId: 'model-a',
        connectionId: 201,
        rawId: 'model-a-raw',
        attemptIndex: 1,
        output: '模型输出-1',
        reasoning: '',
        usageJson: '{}',
        durationMs: 100,
        error: null,
        judgeStatus: 'unknown',
        judgeError: null,
        judgePass: null,
        judgeScore: null,
        judgeReason: null,
        judgeFallbackUsed: false,
      },
      {
        id: 102,
        battleRunId: 9,
        questionIndex: 2,
        questionId: null,
        questionTitle: 'Q2',
        modelId: 'model-a',
        connectionId: 201,
        rawId: 'model-a-raw',
        attemptIndex: 2,
        output: '模型输出-2',
        reasoning: '',
        usageJson: '{}',
        durationMs: 120,
        error: null,
        judgeStatus: 'unknown',
        judgeError: null,
        judgePass: null,
        judgeScore: null,
        judgeReason: null,
        judgeFallbackUsed: false,
      },
    ]

    const prisma = {
      battleRun: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(runRecord)
          .mockResolvedValueOnce({
            id: 9,
            mode: 'single_model_multi_question',
            configJson: JSON.stringify(runConfig),
            runsPerModel: 1,
            passK: 1,
            judgeThreshold: 0.75,
          }),
        update: jest.fn(async () => ({})),
      },
      battleResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(candidates)
          .mockResolvedValueOnce([]),
        updateMany: jest.fn(async () => ({ count: 2 })),
        update: jest.fn(async () => ({})),
      },
      modelCatalog: {
        findFirst: jest.fn(async () => null),
      },
    }

    const modelResolver = {
      resolveModelForRequest: jest.fn(async () => ({
        connection: { id: 101, prefixId: 'judge' },
        rawModelId: 'judge-raw',
      })),
    }

    const executor = {
      judgeAnswer: jest
        .fn()
        .mockResolvedValueOnce({
          pass: true,
          score: 0.9,
          reason: 'ok',
          fallbackUsed: false,
          raw: {},
        })
        .mockResolvedValueOnce({
          pass: false,
          score: 0.2,
          reason: 'no',
          fallbackUsed: false,
          raw: {},
        }),
    }

    const imageService = {
      loadImages: jest.fn(async () => []),
      resolveImageUrls: jest.fn((paths: string[]) => paths),
    }

    const { service } = createService({
      prisma,
      modelResolver,
      executor,
      imageService,
    })

    const result = await service.retryJudgeForRun(ACTOR, { runId: 9 })

    expect(result).toEqual({
      total: 2,
      updated: 2,
      skipped: 0,
      errors: 0,
      resultIds: [101, 102],
    })
    expect(executor.judgeAnswer).toHaveBeenCalledTimes(2)
    expect(executor.judgeAnswer.mock.calls[0][0]).toMatchObject({
      prompt: '题目-1',
      expectedAnswer: '答案-1',
      answer: '模型输出-1',
      threshold: 0.75,
    })
    expect(executor.judgeAnswer.mock.calls[1][0]).toMatchObject({
      prompt: '题目-2',
      expectedAnswer: '答案-2',
      answer: '模型输出-2',
      threshold: 0.75,
    })
  })
})
