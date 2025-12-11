/**
 * 向量数据库工厂
 */

import path from 'path'
import type { VectorDBClient, VectorDBConfig } from './types'
import { SQLiteVectorClient } from './sqlite-vector-client'

export function createVectorDBClient(config: VectorDBConfig): VectorDBClient {
  switch (config.type) {
    case 'sqlite':
      return new SQLiteVectorClient(path.join(config.dataPath, 'vector.db'))

    case 'chroma':
      // ChromaDB 支持可以后续添加
      // 目前回退到 SQLite 实现
      console.warn('[VectorDB] ChromaDB not yet implemented, falling back to SQLite')
      return new SQLiteVectorClient(path.join(config.dataPath, 'vector.db'))

    default:
      throw new Error(`Unknown vector DB type: ${config.type}`)
  }
}

export * from './types'
export { SQLiteVectorClient } from './sqlite-vector-client'
