/**
 * 一次性执行域迁移脚本（Chat + Battle）
 *
 * 用法：
 * pnpm --filter backend tsx scripts/migrate-execution-domain.ts
 * pnpm --filter backend tsx scripts/migrate-execution-domain.ts --dry-run
 * pnpm --filter backend tsx scripts/migrate-execution-domain.ts --batch-size=200 --resume-battle-id=1200
 *
 * 说明：
 * - 本脚本会把历史 BattleRun/BattleResult 与 Chat assistant 消息回填到 execution_* 结构
 * - 设计为可重入（upsert + 去重），支持断点续跑
 */

/// <reference types="node" />

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const db = prisma as any

type MigrationOptions = {
  dryRun: boolean
  includeBattle: boolean
  includeChat: boolean
  batchSize: number
  resumeBattleId: number
  resumeMessageId: number
}

type MigrationStats = {
  scannedRuns: number
  migratedRuns: number
  scannedSteps: number
  migratedSteps: number
  scannedMessages: number
  migratedMessages: number
}

const parseIntArg = (raw: string | undefined, fallback: number, min = 0) => {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

const parseArgs = (): MigrationOptions => {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const includeBattle = !args.includes('--no-battle')
  const includeChat = !args.includes('--no-chat')
  const batchSize = parseIntArg(args.find((item) => item.startsWith('--batch-size='))?.split('=')[1], 100, 1)
  const resumeBattleId = parseIntArg(
    args.find((item) => item.startsWith('--resume-battle-id='))?.split('=')[1],
    0,
    0,
  )
  const resumeMessageId = parseIntArg(
    args.find((item) => item.startsWith('--resume-message-id='))?.split('=')[1],
    0,
    0,
  )
  return {
    dryRun,
    includeBattle,
    includeChat,
    batchSize,
    resumeBattleId,
    resumeMessageId,
  }
}

const toJson = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

const toStatus = (status: unknown): string => {
  if (status === 'pending') return 'pending'
  if (status === 'running') return 'running'
  if (status === 'retrying') return 'retrying'
  if (status === 'completed' || status === 'done' || status === 'success') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  return status === 'error' ? 'error' : 'completed'
}

const toStepStatusFromBattleResult = (result: any): string => {
  if (typeof result?.error === 'string' && result.error.trim().length > 0) return 'error'
  if (result?.judgeStatus === 'running') return 'running'
  return 'completed'
}

const toStepStatusFromChatMessage = (message: any): string => {
  if (message?.streamStatus === 'cancelled') return 'cancelled'
  if (message?.streamStatus === 'error') return 'error'
  if (message?.streamStatus === 'streaming' || message?.streamStatus === 'running') return 'running'
  return 'completed'
}

const buildBattleModelKey = (result: any) => {
  if (result?.connectionId != null && result?.rawId) {
    return `${String(result.connectionId)}:${String(result.rawId)}`
  }
  return String(result?.modelId || 'model')
}

const ensureArtifact = async (
  runId: number,
  stepId: number | null,
  kind: string,
  name: string | null,
  data: unknown,
  dryRun: boolean,
) => {
  if (dryRun) return
  const where = {
    runId,
    ...(stepId ? { stepId } : {}),
    kind,
    ...(name ? { name } : {}),
  }
  const existing = await db.executionArtifact.findFirst({ where })
  if (existing) {
    await db.executionArtifact.update({
      where: { id: existing.id },
      data: {
        dataJson: toJson(data),
      },
    })
    return
  }
  await db.executionArtifact.create({
    data: {
      runId,
      ...(stepId ? { stepId } : {}),
      kind,
      ...(name ? { name } : {}),
      dataJson: toJson(data),
    },
  })
}

const upsertExecutionEvent = async (params: {
  dryRun: boolean
  runId: number
  stepId?: number | null
  eventId: string
  type: string
  status: string
  ts: Date
  agentRole?: string | null
  payload: unknown
}) => {
  if (params.dryRun) return
  await db.executionEvent.upsert({
    where: {
      runId_eventId: {
        runId: params.runId,
        eventId: params.eventId,
      },
    },
    create: {
      runId: params.runId,
      ...(params.stepId ? { stepId: params.stepId } : {}),
      eventId: params.eventId,
      type: params.type,
      status: params.status,
      ts: params.ts,
      ...(params.agentRole ? { agentRole: params.agentRole } : {}),
      payloadJson: toJson(params.payload),
    },
    update: {
      type: params.type,
      status: params.status,
      ts: params.ts,
      ...(params.agentRole ? { agentRole: params.agentRole } : {}),
      payloadJson: toJson(params.payload),
    },
  })
}

const migrateBattleRuns = async (options: MigrationOptions, stats: MigrationStats) => {
  if (!options.includeBattle) return

  console.log('\n[Battle] 开始迁移...')
  let cursor = options.resumeBattleId
  while (true) {
    const runs = await prisma.battleRun.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      include: {
        results: {
          orderBy: [{ questionIndex: 'asc' }, { attemptIndex: 'asc' }, { id: 'asc' }],
        },
      },
    })
    if (runs.length === 0) break

    for (const run of runs) {
      cursor = run.id
      stats.scannedRuns += 1
      stats.scannedSteps += run.results.length

      const runKey = `battle-run-${run.id}`
      const runStatus = toStatus(run.status)
      const runCompleted = runStatus === 'completed' || runStatus === 'cancelled' || runStatus === 'error'
      const completedAt = runCompleted ? run.updatedAt : null

      if (!options.dryRun) {
        const executionRun = await db.executionRun.upsert({
          where: { runKey },
          create: {
            runKey,
            sourceType: 'battle',
            sourceId: String(run.id),
            mode: run.mode || 'multi_model',
            title: run.title || null,
            status: runStatus,
            inputJson: toJson({
              prompt: run.prompt,
              promptImages: run.promptImagesJson,
              expectedAnswer: run.expectedAnswer,
              expectedAnswerImages: run.expectedAnswerImagesJson,
              judgeModelId: run.judgeModelId,
              judgeConnectionId: run.judgeConnectionId,
              judgeRawId: run.judgeRawId,
              judgeThreshold: run.judgeThreshold,
              runsPerModel: run.runsPerModel,
              passK: run.passK,
              config: run.configJson,
            }),
            outputJson: toJson({ summary: run.summaryJson }),
            startedAt: run.createdAt,
            ...(completedAt ? { completedAt } : {}),
          },
          update: {
            sourceType: 'battle',
            sourceId: String(run.id),
            mode: run.mode || 'multi_model',
            title: run.title || null,
            status: runStatus,
            inputJson: toJson({
              prompt: run.prompt,
              promptImages: run.promptImagesJson,
              expectedAnswer: run.expectedAnswer,
              expectedAnswerImages: run.expectedAnswerImagesJson,
              judgeModelId: run.judgeModelId,
              judgeConnectionId: run.judgeConnectionId,
              judgeRawId: run.judgeRawId,
              judgeThreshold: run.judgeThreshold,
              runsPerModel: run.runsPerModel,
              passK: run.passK,
              config: run.configJson,
            }),
            outputJson: toJson({ summary: run.summaryJson }),
            startedAt: run.createdAt,
            ...(completedAt ? { completedAt } : {}),
          },
        })

        await upsertExecutionEvent({
          dryRun: false,
          runId: executionRun.id,
          eventId: `${runKey}:legacy:run_start`,
          type: 'run_start',
          status: 'running',
          ts: run.createdAt,
          payload: {
            sourceType: 'battle',
            sourceId: String(run.id),
            mode: run.mode || 'multi_model',
            title: run.title || null,
          },
        })

        for (const result of run.results) {
          const modelKey = buildBattleModelKey(result)
          const stepKey = `${modelKey}:q${result.questionIndex || 1}:a${result.attemptIndex}`
          const stepStatus = toStepStatusFromBattleResult(result)
          const stepCompleted =
            stepStatus === 'completed' || stepStatus === 'cancelled' || stepStatus === 'error'
          const stepCompletedAt = stepCompleted ? run.updatedAt : null

          const step = await db.executionStep.upsert({
            where: {
              runId_stepKey: {
                runId: executionRun.id,
                stepKey,
              },
            },
            create: {
              runId: executionRun.id,
              stepKey,
              agentRole: result.rawId || result.modelId || null,
              title: 'battle_attempt',
              status: stepStatus,
              metadataJson: toJson({
                modelId: result.modelId,
                connectionId: result.connectionId,
                rawId: result.rawId,
                questionIndex: result.questionIndex,
                attemptIndex: result.attemptIndex,
              }),
              resultJson: toJson({
                output: result.output,
                reasoning: result.reasoning,
                usage: result.usageJson,
                judgeStatus: result.judgeStatus,
                judgePass: result.judgePass,
                judgeScore: result.judgeScore,
                judgeReason: result.judgeReason,
              }),
              error: result.error || result.judgeError || null,
              startedAt: run.createdAt,
              ...(stepCompletedAt ? { completedAt: stepCompletedAt } : {}),
            },
            update: {
              status: stepStatus,
              metadataJson: toJson({
                modelId: result.modelId,
                connectionId: result.connectionId,
                rawId: result.rawId,
                questionIndex: result.questionIndex,
                attemptIndex: result.attemptIndex,
              }),
              resultJson: toJson({
                output: result.output,
                reasoning: result.reasoning,
                usage: result.usageJson,
                judgeStatus: result.judgeStatus,
                judgePass: result.judgePass,
                judgeScore: result.judgeScore,
                judgeReason: result.judgeReason,
              }),
              error: result.error || result.judgeError || null,
              startedAt: run.createdAt,
              ...(stepCompletedAt ? { completedAt: stepCompletedAt } : {}),
            },
          })

          await ensureArtifact(
            executionRun.id,
            step.id,
            'text',
            'battle_output',
            { output: result.output || '' },
            false,
          )

          if (typeof result.reasoning === 'string' && result.reasoning.trim().length > 0) {
            await ensureArtifact(
              executionRun.id,
              step.id,
              'text',
              'battle_reasoning',
              { reasoning: result.reasoning },
              false,
            )
          }

          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            stepId: step.id,
            eventId: `${runKey}:legacy:step_complete:${stepKey}`,
            type: 'step_complete',
            status: stepStatus,
            ts: run.updatedAt,
            agentRole: result.rawId || result.modelId || null,
            payload: {
              result: {
                modelId: result.modelId,
                connectionId: result.connectionId,
                rawId: result.rawId,
                questionIndex: result.questionIndex,
                attemptIndex: result.attemptIndex,
                output: result.output,
                reasoning: result.reasoning,
                error: result.error,
                judgeStatus: result.judgeStatus,
                judgeError: result.judgeError,
                judgePass: result.judgePass,
                judgeScore: result.judgeScore,
                judgeReason: result.judgeReason,
              },
              error: result.error || result.judgeError || null,
            },
          })

          stats.migratedSteps += 1
        }

        if (runStatus === 'completed') {
          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            eventId: `${runKey}:legacy:run_complete`,
            type: 'run_complete',
            status: 'completed',
            ts: run.updatedAt,
            payload: {
              summary: JSON.parse(run.summaryJson || '{}'),
            },
          })
        } else if (runStatus === 'cancelled' || runStatus === 'error') {
          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            eventId: `${runKey}:legacy:run_error`,
            type: 'run_error',
            status: runStatus,
            ts: run.updatedAt,
            payload: {
              message: runStatus === 'cancelled' ? 'Run cancelled' : 'Run failed',
            },
          })
        }

        if (runCompleted) {
          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            eventId: `${runKey}:legacy:complete`,
            type: 'complete',
            status: runStatus,
            ts: run.updatedAt,
            payload: {},
          })
        }
      }

      stats.migratedRuns += 1
    }

    console.log(`[Battle] 已处理到 runId=${cursor}`)
  }
}

const migrateChatMessages = async (options: MigrationOptions, stats: MigrationStats) => {
  if (!options.includeChat) return

  console.log('\n[Chat] 开始迁移...')
  let cursor = options.resumeMessageId
  while (true) {
    const messages = await prisma.message.findMany({
      where: {
        id: { gt: cursor },
        role: 'assistant',
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      select: {
        id: true,
        sessionId: true,
        clientMessageId: true,
        content: true,
        reasoning: true,
        streamStatus: true,
        streamError: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (messages.length === 0) break

    for (const message of messages) {
      cursor = message.id
      stats.scannedMessages += 1

      const runKey = `chat-msg-${message.id}`
      const runStatus = toStatus(message.streamStatus)
      const runCompleted = runStatus === 'completed' || runStatus === 'cancelled' || runStatus === 'error'
      const completedAt = runCompleted ? message.updatedAt : null
      const stepKey = `assistant:${message.id}`
      const stepStatus = toStepStatusFromChatMessage(message)

      if (!options.dryRun) {
        const executionRun = await db.executionRun.upsert({
          where: { runKey },
          create: {
            runKey,
            sourceType: 'chat',
            sourceId: message.clientMessageId || String(message.id),
            mode: 'chat',
            title: null,
            status: runStatus,
            inputJson: toJson({
              sessionId: message.sessionId,
              assistantMessageId: message.id,
            }),
            outputJson: toJson({
              content: message.content || '',
              reasoning: message.reasoning || '',
            }),
            errorJson: toJson(
              message.streamError
                ? { message: message.streamError }
                : {},
            ),
            startedAt: message.createdAt,
            ...(completedAt ? { completedAt } : {}),
          },
          update: {
            status: runStatus,
            sourceId: message.clientMessageId || String(message.id),
            inputJson: toJson({
              sessionId: message.sessionId,
              assistantMessageId: message.id,
            }),
            outputJson: toJson({
              content: message.content || '',
              reasoning: message.reasoning || '',
            }),
            errorJson: toJson(
              message.streamError
                ? { message: message.streamError }
                : {},
            ),
            startedAt: message.createdAt,
            ...(completedAt ? { completedAt } : {}),
          },
        })

        const step = await db.executionStep.upsert({
          where: {
            runId_stepKey: {
              runId: executionRun.id,
              stepKey,
            },
          },
          create: {
            runId: executionRun.id,
            stepKey,
            agentRole: 'assistant',
            title: 'assistant_response',
            status: stepStatus,
            metadataJson: toJson({
              sessionId: message.sessionId,
              assistantMessageId: message.id,
            }),
            resultJson: toJson({
              content: message.content || '',
              reasoning: message.reasoning || '',
            }),
            error: message.streamError || null,
            startedAt: message.createdAt,
            ...(runCompleted ? { completedAt: message.updatedAt } : {}),
          },
          update: {
            status: stepStatus,
            metadataJson: toJson({
              sessionId: message.sessionId,
              assistantMessageId: message.id,
            }),
            resultJson: toJson({
              content: message.content || '',
              reasoning: message.reasoning || '',
            }),
            error: message.streamError || null,
            startedAt: message.createdAt,
            ...(runCompleted ? { completedAt: message.updatedAt } : {}),
          },
        })

        await ensureArtifact(
          executionRun.id,
          step.id,
          'text',
          'assistant_output',
          { content: message.content || '' },
          false,
        )

        if (typeof message.reasoning === 'string' && message.reasoning.trim().length > 0) {
          await ensureArtifact(
            executionRun.id,
            step.id,
            'text',
            'assistant_reasoning',
            { reasoning: message.reasoning },
            false,
          )
        }

        await upsertExecutionEvent({
          dryRun: false,
          runId: executionRun.id,
          eventId: `${runKey}:legacy:run_start`,
          type: 'run_start',
          status: 'running',
          ts: message.createdAt,
          payload: {
            sourceType: 'chat',
            sourceId: message.clientMessageId || String(message.id),
            mode: 'chat',
            input: {
              sessionId: message.sessionId,
              assistantMessageId: message.id,
            },
          },
        })

        await upsertExecutionEvent({
          dryRun: false,
          runId: executionRun.id,
          stepId: step.id,
          eventId: `${runKey}:legacy:step_start`,
          type: 'step_start',
          status: 'running',
          ts: message.createdAt,
          agentRole: 'assistant',
          payload: {
            title: 'assistant_response',
            metadata: {
              sessionId: message.sessionId,
            },
          },
        })

        await upsertExecutionEvent({
          dryRun: false,
          runId: executionRun.id,
          stepId: step.id,
          eventId: `${runKey}:legacy:step_complete`,
          type: 'step_complete',
          status: stepStatus,
          ts: message.updatedAt,
          agentRole: 'assistant',
          payload: {
            result: {
              content: message.content || '',
              reasoning: message.reasoning || '',
            },
            error: message.streamError || null,
          },
        })

        if (runStatus === 'completed') {
          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            eventId: `${runKey}:legacy:run_complete`,
            type: 'run_complete',
            status: 'completed',
            ts: message.updatedAt,
            payload: {
              output: {
                content: message.content || '',
                reasoning: message.reasoning || '',
              },
            },
          })
        } else if (runStatus === 'cancelled' || runStatus === 'error') {
          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            eventId: `${runKey}:legacy:run_error`,
            type: 'run_error',
            status: runStatus,
            ts: message.updatedAt,
            payload: {
              message: message.streamError || (runStatus === 'cancelled' ? 'Run cancelled' : 'Run failed'),
            },
          })
        }

        if (runCompleted) {
          await upsertExecutionEvent({
            dryRun: false,
            runId: executionRun.id,
            eventId: `${runKey}:legacy:complete`,
            type: 'complete',
            status: runStatus,
            ts: message.updatedAt,
            payload: {},
          })
        }
      }

      stats.migratedMessages += 1
    }

    console.log(`[Chat] 已处理到 messageId=${cursor}`)
  }
}

async function main() {
  const options = parseArgs()
  const stats: MigrationStats = {
    scannedRuns: 0,
    migratedRuns: 0,
    scannedSteps: 0,
    migratedSteps: 0,
    scannedMessages: 0,
    migratedMessages: 0,
  }

  console.log('=== 执行域一次性迁移 ===')
  console.log('参数:', {
    dryRun: options.dryRun,
    includeBattle: options.includeBattle,
    includeChat: options.includeChat,
    batchSize: options.batchSize,
    resumeBattleId: options.resumeBattleId,
    resumeMessageId: options.resumeMessageId,
  })

  await migrateBattleRuns(options, stats)
  await migrateChatMessages(options, stats)

  console.log('\n=== 迁移完成 ===')
  console.log(`Battle runs: ${stats.migratedRuns}/${stats.scannedRuns}`)
  console.log(`Battle steps: ${stats.migratedSteps}/${stats.scannedSteps}`)
  console.log(`Chat messages: ${stats.migratedMessages}/${stats.scannedMessages}`)
  if (options.dryRun) {
    console.log('[DRY RUN] 未写入数据库')
  }
}

main()
  .catch((error) => {
    console.error('[execution-migration] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
