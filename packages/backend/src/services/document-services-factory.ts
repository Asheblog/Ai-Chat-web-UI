/**
 * 文档服务工厂
 * 初始化和配置文档相关服务
 *
 * 特性:
 * - 向量数据库客户端自动复用（通过 createVectorDBClient 单例模式）
 * - 支持配置热重载，无需重建数据库连接
 */

import { PrismaClient } from '@prisma/client'
import path from 'path'
import { createVectorDBClient, getVectorDBClient } from '../modules/document/vector'
import { EmbeddingService, type EmbeddingConfig } from './document/embedding-service'
import { DocumentService, type DocumentServiceConfig } from './document/document-service'
import { RAGService, type RAGConfig } from './document/rag-service'
import { CleanupScheduler, type CleanupConfig } from './cleanup/cleanup-scheduler'

export interface DocumentServicesConfig {
  /**
   * 数据目录路径
   */
  dataDir: string

  /**
   * Embedding 配置
   */
  embedding: EmbeddingConfig

  /**
   * 文档服务配置
   */
  document: Omit<DocumentServiceConfig, 'storageDir'>

  /**
   * RAG 配置
   */
  rag: RAGConfig

  /**
   * 清理配置
   */
  cleanup: CleanupConfig
}

export interface DocumentServices {
  embeddingService: EmbeddingService
  documentService: DocumentService
  ragService: RAGService
  cleanupScheduler: CleanupScheduler
}

function resolveDefaultDataDir(): string {
  const fromEnv = process.env.APP_DATA_DIR || process.env.RAG_DATA_DIR || process.env.DATA_DIR
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
  return './data'
}

/**
 * 默认配置
 */
export const DEFAULT_DOCUMENT_SERVICES_CONFIG: DocumentServicesConfig = {
  dataDir: resolveDefaultDataDir(),
  embedding: {
    engine: 'openai',
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
    apiUrl: process.env.OPENAI_API_URL,
  },
  document: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    chunkSize: 1500,
    chunkOverlap: 100,
    retentionDays: 30,
  },
  rag: {
    topK: 5,
    relevanceThreshold: 0.3,
    maxContextTokens: 4000,
  },
  cleanup: {
    enabled: true,
    intervalMs: 60 * 60 * 1000, // 1 hour
    retentionDays: 30,
    orphanedRetentionHours: 24,
    maxTotalStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB
    databaseSizeWarningBytes: 1 * 1024 * 1024 * 1024, // 1GB
  },
}

/**
 * 创建文档相关服务
 *
 * 注意: 向量数据库客户端通过单例模式自动复用，
 * 多次调用此函数不会创建多个数据库连接
 */
export function createDocumentServices(
  prisma: PrismaClient,
  config: Partial<DocumentServicesConfig> = {}
): DocumentServices {
  // 合并配置
  const fullConfig: DocumentServicesConfig = {
    ...DEFAULT_DOCUMENT_SERVICES_CONFIG,
    ...config,
    embedding: { ...DEFAULT_DOCUMENT_SERVICES_CONFIG.embedding, ...config.embedding },
    document: { ...DEFAULT_DOCUMENT_SERVICES_CONFIG.document, ...config.document },
    rag: { ...DEFAULT_DOCUMENT_SERVICES_CONFIG.rag, ...config.rag },
    cleanup: { ...DEFAULT_DOCUMENT_SERVICES_CONFIG.cleanup, ...config.cleanup },
  }

  const vectorDataPath = path.join(fullConfig.dataDir, 'vector')

  // 优先复用已存在的向量数据库客户端，避免重复创建
  // createVectorDBClient 内部已实现单例模式，这里显式检查只是为了日志清晰
  const existingClient = getVectorDBClient(vectorDataPath)
  const vectorDB = existingClient || createVectorDBClient({
    type: 'sqlite',
    dataPath: vectorDataPath,
  })

  if (existingClient) {
    console.log('[DocumentServices] Reusing existing vector database connection')
  }

  // 创建 Embedding 服务
  const embeddingService = new EmbeddingService(fullConfig.embedding)

  // 创建文档服务
  const documentService = new DocumentService(
    prisma,
    vectorDB,
    embeddingService,
    {
      ...fullConfig.document,
      storageDir: path.join(fullConfig.dataDir, 'documents'),
    }
  )

  // 创建 RAG 服务
  const ragService = new RAGService(
    prisma,
    vectorDB,
    embeddingService,
    fullConfig.rag
  )

  // 创建清理调度器
  const cleanupScheduler = new CleanupScheduler(
    prisma,
    vectorDB,
    fullConfig.cleanup
  )

  return {
    embeddingService,
    documentService,
    ragService,
    cleanupScheduler,
  }
}

// 全局单例（可选）
let documentServicesInstance: DocumentServices | null = null

export function initDocumentServices(
  prisma: PrismaClient,
  config?: Partial<DocumentServicesConfig>
): DocumentServices {
  if (documentServicesInstance) {
    return documentServicesInstance
  }

  documentServicesInstance = createDocumentServices(prisma, config)
  return documentServicesInstance
}

export function getDocumentServices(): DocumentServices | null {
  return documentServicesInstance
}

export function setDocumentServices(services: DocumentServices): void {
  documentServicesInstance = services
}
