/**
 * 向量数据库客户端接口和类型定义
 */

export interface VectorItem {
  id: string
  text: string
  vector: number[]
  metadata: Record<string, unknown>
}

export interface SearchResult {
  id: string
  text: string
  score: number
  metadata: Record<string, unknown>
}

export interface VectorDBClient {
  /**
   * 检查 collection 是否存在
   */
  hasCollection(collectionName: string): Promise<boolean>

  /**
   * 创建 collection
   */
  createCollection(collectionName: string): Promise<void>

  /**
   * 删除 collection
   * @param vacuum - 是否执行 VACUUM 释放磁盘空间，默认 true
   */
  deleteCollection(collectionName: string, vacuum?: boolean): Promise<void>

  /**
   * 插入向量
   */
  insert(collectionName: string, items: VectorItem[]): Promise<void>

  /**
   * 向量搜索
   */
  search(
    collectionName: string,
    queryVector: number[],
    limit: number
  ): Promise<SearchResult[]>

  /**
   * 根据 ID 删除
   */
  deleteByIds(collectionName: string, ids: string[]): Promise<void>

  /**
   * 获取 collection 中的所有项目数量
   */
  count(collectionName: string): Promise<number>

  /**
   * 重置整个向量数据库
   */
  reset(): Promise<void>

  /**
   * 执行 VACUUM 压缩数据库（释放已删除数据的磁盘空间）
   * 注意：此操作可能较慢，建议在批量删除后统一执行一次
   */
  vacuum(): void

  /**
   * 关闭连接
   */
  close(): Promise<void>
}

/**
 * 向量数据库配置
 */
export interface VectorDBConfig {
  type: 'sqlite' | 'chroma'
  dataPath: string
  // ChromaDB 特定配置
  chromaHost?: string
  chromaPort?: number
}
