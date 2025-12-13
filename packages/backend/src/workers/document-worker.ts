/**
 * 文档处理 Worker
 *
 * 该进程独立于 API 服务运行，通过轮询 document_processing_jobs 表
 * 异步消费文档解析/分块/embedding 任务，避免重活阻塞 API 主线程。
 */

import os from 'os'
import { createAppContainer } from '../container/app-container'
import { setRAGInitializerDeps, reloadRAGServices } from '../services/rag-initializer'
import { getDocumentServices } from '../services/document-services-factory'
import { BackendLogger as log } from '../utils/logger'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const WORKER_ID =
  process.env.DOCUMENT_WORKER_ID || `${os.hostname()}_${process.pid}`
const POLL_INTERVAL_MS = Number.parseInt(
  process.env.DOCUMENT_WORKER_POLL_INTERVAL_MS || '2000',
  10
)
// 当 RAG 服务未启用时，定期尝试重新加载配置的间隔（默认 10 秒）
const RAG_RELOAD_INTERVAL_MS = Number.parseInt(
  process.env.DOCUMENT_WORKER_RAG_RELOAD_INTERVAL_MS || '10000',
  10
)

async function claimNextJob(prisma: any) {
  const now = new Date()
  const job = await prisma.documentProcessingJob.findFirst({
    where: {
      status: { in: ['pending', 'retrying'] },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
  })

  if (!job) return null

  // 乐观锁：只有状态未变化时才抢占
  const updated = await prisma.documentProcessingJob.updateMany({
    where: { id: job.id, status: job.status },
    data: {
      status: 'running',
      workerId: WORKER_ID,
      lockedAt: now,
      updatedAt: now,
      attempts: { increment: 1 },
    },
  })

  if (updated.count === 0) return null
  return job
}

async function runWorker() {
  const container = createAppContainer()
  const prisma = container.context.prisma as any

  setRAGInitializerDeps({ prisma })
  await reloadRAGServices()

  log.info(`[DocumentWorker] Started, id=${WORKER_ID}, poll=${POLL_INTERVAL_MS}ms`)

  // 记录上次尝试 reload RAG 配置的时间
  let lastRagReloadAttempt = Date.now()

  while (true) {
    try {
      let services = getDocumentServices()

      // 如果 services 为 null，定期尝试重新加载 RAG 配置
      // 这样当用户在前端开启 RAG 后，worker 能够感知到变更
      if (!services) {
        const now = Date.now()
        if (now - lastRagReloadAttempt >= RAG_RELOAD_INTERVAL_MS) {
          lastRagReloadAttempt = now
          const result = await reloadRAGServices()
          if (result.success && result.message !== 'RAG services disabled') {
            log.info('[DocumentWorker] RAG services reloaded', { message: result.message })
            services = getDocumentServices()
          }
        }

        if (!services) {
          await sleep(POLL_INTERVAL_MS)
          continue
        }
      }

      const job = await claimNextJob(prisma)
      if (!job) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      log.info('[DocumentWorker] Processing job', {
        jobId: job.id,
        documentId: job.documentId,
        attempts: job.attempts,
      })

      try {
        await services.documentService.processDocument(job.documentId, undefined, job.id)

        await prisma.documentProcessingJob.update({
          where: { id: job.id },
          data: {
            status: 'done',
            lastError: null,
            nextRunAt: null,
            lockedAt: null,
          },
        })

        log.info('[DocumentWorker] Job done', { jobId: job.id })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const fresh = await prisma.documentProcessingJob.findUnique({
          where: { id: job.id },
        })
        const attempts = fresh?.attempts ?? 1
        const maxAttempts = fresh?.maxAttempts ?? 2

        if (fresh?.status === 'canceled') {
          await prisma.documentProcessingJob.update({
            where: { id: job.id },
            data: {
              status: 'canceled',
              lastError: message,
              lockedAt: null,
              nextRunAt: null,
            },
          })
          log.info('[DocumentWorker] Job canceled', { jobId: job.id })
          continue
        }

        if (attempts >= maxAttempts) {
          await prisma.documentProcessingJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              lastError: message,
              lockedAt: null,
              nextRunAt: null,
            },
          })
          log.warn('[DocumentWorker] Job failed', { jobId: job.id, message })
        } else {
          await prisma.documentProcessingJob.update({
            where: { id: job.id },
            data: {
              status: 'retrying',
              lastError: message,
              lockedAt: null,
              nextRunAt: new Date(Date.now() + 2000),
            },
          })
          log.warn('[DocumentWorker] Job retrying', {
            jobId: job.id,
            attempts,
            maxAttempts,
            message,
          })
        }
      }
    } catch (loopErr) {
      log.error('[DocumentWorker] Loop error', loopErr)
      await sleep(POLL_INTERVAL_MS)
    }
  }
}

runWorker().catch((err) => {
  log.error('[DocumentWorker] Fatal error', err)
  process.exit(1)
})
