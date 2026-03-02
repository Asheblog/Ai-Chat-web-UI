import type { Actor } from '../types'
import type { DocumentService } from '../services/document/document-service'
import type { RAGService } from '../services/document/rag-service'

declare module 'hono' {
  interface ContextVariableMap {
    actor: Actor
    user?: {
      id: number
      username: string
      role: 'ADMIN' | 'USER'
      status: 'PENDING' | 'ACTIVE' | 'DISABLED'
      avatarUrl?: string | null
    }
    docServices?: {
      documentService: DocumentService
      ragService: RAGService
    } | null
  }

  interface Context {
    json<T>(
      object: T,
      status?: number,
      headers?: Record<string, string | string[]>,
    ): Response
  }
}
