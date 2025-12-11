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
   * 加载文档内容
   */
  load(filePath: string, mimeType: string): Promise<DocumentContent[]>
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
