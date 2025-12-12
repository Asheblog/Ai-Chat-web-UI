/**
 * RAG 服务初始化器
 * 支持动态加载/重载 RAG 服务配置
 */

import type { PrismaClient } from '@prisma/client'
import { AuthUtils } from '../utils/auth'
import {
  createDocumentServices,
  getDocumentServices,
  setDocumentServices,
  type DocumentServices,
} from './document-services-factory'

export interface RAGInitializerDeps {
  prisma: PrismaClient
}

let deps: RAGInitializerDeps | null = null
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isSqliteLockingProtocolError(error: unknown): boolean {
  if (!error) return false
  const anyErr = error as any
  const code = String(anyErr?.code || '')
  const message = String(anyErr?.message || '')
  return code === 'SQLITE_PROTOCOL' || /locking protocol/i.test(message)
}

/**
 * 设置初始化器依赖
 */
export function setRAGInitializerDeps(d: RAGInitializerDeps): void {
  deps = d
}

/**
 * 从数据库设置初始化/重载 RAG 服务
 * @returns 是否成功初始化
 */
export async function reloadRAGServices(): Promise<{ success: boolean; message: string }> {
  if (!deps) {
    return { success: false, message: 'RAG initializer dependencies not set' }
  }

  const { prisma } = deps

  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 停止现有服务
      const existingServices = getDocumentServices()
      if (existingServices) {
        existingServices.cleanupScheduler.stop()
        console.log('🔄 Stopping existing RAG services...')
      }

      // 从数据库读取 RAG 设置
      const settings = await prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'rag_enabled',
              'rag_embedding_connection_id',
              'rag_embedding_model_id',
              'rag_embedding_batch_size',
              'rag_embedding_concurrency',
              'rag_top_k',
              'rag_relevance_threshold',
              'rag_max_context_tokens',
              'rag_chunk_size',
              'rag_chunk_overlap',
              'rag_max_file_size_mb',
              'rag_retention_days',
            ],
          },
        },
      })

      const settingsMap = settings.reduce<Record<string, string>>((acc, s) => {
        acc[s.key] = s.value ?? ''
        return acc
      }, {})

      // 检查是否启用 RAG
      const ragEnabled = settingsMap.rag_enabled?.toLowerCase() === 'true'
      if (!ragEnabled) {
        // 清除现有服务
        setDocumentServices(null as any)
        console.log('ℹ️  Document RAG services disabled')
        return { success: true, message: 'RAG services disabled' }
      }

      // 获取选择的连接和模型
      const connectionIdStr = settingsMap.rag_embedding_connection_id
      const modelId = settingsMap.rag_embedding_model_id

      if (!connectionIdStr || !modelId) {
        setDocumentServices(null as any)
        console.log('⚠️  Document RAG enabled but no embedding model selected')
        return { success: false, message: 'No embedding model selected' }
      }

      const connectionId = parseInt(connectionIdStr, 10)
      if (!Number.isFinite(connectionId) || connectionId <= 0) {
        return { success: false, message: 'Invalid connection ID' }
      }

      // 从连接管理获取连接信息
      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
      })

      if (!connection) {
        return { success: false, message: `Connection not found: ${connectionId}` }
      }

      // 获取连接的 API URL 和密钥（密钥是加密存储的，需要解密）
      const apiUrl = connection.baseUrl || 'https://api.openai.com/v1'
      const encryptedApiKey = connection.apiKey

      if (!encryptedApiKey) {
        return { success: false, message: `Connection has no API key: ${connection.name || connectionId}` }
      }

      // 解密 API Key
      const apiKey = AuthUtils.decryptApiKey(encryptedApiKey)

      // 创建新的文档服务
      const embeddingBatchSize = Math.max(
        1,
        Math.min(128, parseInt(settingsMap.rag_embedding_batch_size || '1', 10) || 1)
      )
      const embeddingConcurrency = Math.max(
        1,
        Math.min(16, parseInt(settingsMap.rag_embedding_concurrency || '1', 10) || 1)
      )

      const dataDir = String(
        process.env.APP_DATA_DIR || process.env.RAG_DATA_DIR || process.env.DATA_DIR || './data'
      ).trim()

      const documentServices = createDocumentServices(prisma, {
        dataDir,
        embedding: {
          engine: 'openai', // 统一使用 OpenAI 兼容格式
          model: modelId,
          apiKey: apiKey,
          apiUrl: apiUrl,
          batchSize: embeddingBatchSize,
          concurrency: embeddingConcurrency,
        },
        document: {
          maxFileSize: (parseInt(settingsMap.rag_max_file_size_mb || '50', 10) || 50) * 1024 * 1024,
          chunkSize: parseInt(settingsMap.rag_chunk_size || '1500', 10) || 1500,
          chunkOverlap: parseInt(settingsMap.rag_chunk_overlap || '100', 10) || 100,
          retentionDays: parseInt(settingsMap.rag_retention_days || '30', 10) || 30,
        },
        rag: {
          topK: parseInt(settingsMap.rag_top_k || '5', 10) || 5,
          relevanceThreshold: parseFloat(settingsMap.rag_relevance_threshold || '0.3') || 0.3,
          maxContextTokens: parseInt(settingsMap.rag_max_context_tokens || '4000', 10) || 4000,
        },
      })

      setDocumentServices(documentServices)
      documentServices.cleanupScheduler.start()

      console.log('✅ Document RAG services reloaded')
      console.log(`   Connection: ${connection.name || connectionId}, Model: ${modelId}`)

      return { success: true, message: `RAG services initialized with model: ${modelId}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const shouldRetry =
        attempt < maxAttempts && isSqliteLockingProtocolError(error)

      console.warn(
        `⚠️  Failed to reload RAG services (attempt ${attempt}/${maxAttempts}):`,
        message
      )

      if (!shouldRetry) {
        return { success: false, message }
      }

      // 退避与降级：锁协议错误通常来自启动竞态/文件锁暂不可用，等待 2s 后重试 1 次
      await sleep(2000)
    }
  }

  return { success: false, message: 'Failed to reload RAG services' }
}
