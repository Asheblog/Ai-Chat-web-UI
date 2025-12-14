/**
 * 文档加载器类型定义
 */

export interface DocumentContent {
  pageContent: string
  metadata: {
    source: string
    pageNumber?: number
    totalPages?: number
    [key: string]: unknown
  }
}

/**
 * 流式加载选项
 */
export interface StreamLoadOptions {
  /**
   * 最大页数限制（0 表示不限制）
   */
  maxPages?: number

  /**
   * 每页回调，用于流式处理
   * 返回 false 可中止加载
   */
  onPage?: (content: DocumentContent, pageIndex: number) => Promise<boolean | void>
}

export interface DocumentLoader {
  /**
   * 加载器名称
   */
  readonly name: string

  /**
   * 支持的 MIME 类型
   */
  readonly supportedMimeTypes: string[]

  /**
   * 加载文档内容（全量模式，兼容旧接口）
   */
  load(filePath: string, mimeType: string): Promise<DocumentContent[]>

  /**
   * 流式加载文档内容（按页处理，减少内存占用）
   * 如果加载器不支持流式，则回退到全量加载
   */
  loadStream?(filePath: string, mimeType: string, options: StreamLoadOptions): Promise<{
    totalPages: number
    processedPages: number
    skipped: boolean
  }>
}

export interface LoaderOptions {
  /**
   * 最大文件大小（字节）
   */
  maxFileSize?: number

  /**
   * 编码
   */
  encoding?: BufferEncoding
}
