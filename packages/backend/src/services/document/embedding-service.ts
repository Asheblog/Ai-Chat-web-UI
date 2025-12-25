/**
 * Embedding 服务
 * 支持 OpenAI 和 Ollama 双引擎
 */

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const limit = Math.max(1, Math.floor(concurrency) || 1)
  let nextIndex = 0

  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++
      if (current >= items.length) break
      await worker(items[current], current)
    }
  })

  await Promise.all(workers)
}

export interface EmbeddingConfig {
  engine: 'openai' | 'ollama'
  model: string
  apiKey?: string
  apiUrl?: string
  batchSize?: number
  /**
   * 并发请求数（用于不支持大批量/需要加速时）
   */
  concurrency?: number
}

export interface EmbeddingProvider {
  /**
   * 生成单个文本的 embedding
   */
  embed(text: string): Promise<number[]>

  /**
   * 批量生成 embedding
   */
  embedBatch(texts: string[]): Promise<number[][]>

  /**
   * 获取 embedding 维度
   */
  getDimension(): number
}

/**
 * OpenAI Embedding 提供者
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string
  private apiUrl: string
  private model: string
  private batchSize: number
  private concurrency: number
  private dimension: number

  constructor(config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required')
    }

    this.apiKey = config.apiKey
    this.apiUrl = config.apiUrl || 'https://api.openai.com/v1'
    this.model = config.model || 'text-embedding-3-small'
    // 默认 batchSize 为 1，因为很多 OpenAI 兼容 API 不支持批量
    this.batchSize = Math.max(1, Math.floor(config.batchSize || 1))
    // 默认并发为 1，避免意外触发限流；可在系统设置中调高
    this.concurrency = Math.max(1, Math.floor(config.concurrency || 1))

    // 设置维度
    if (this.model === 'text-embedding-3-large') {
      this.dimension = 3072
    } else if (this.model === 'text-embedding-3-small') {
      this.dimension = 1536
    } else if (this.model === 'text-embedding-ada-002') {
      this.dimension = 1536
    } else {
      this.dimension = 1536 // 默认
    }
  }

  async embed(text: string): Promise<number[]> {
    const start = Date.now()
    const results = await this.embedBatch([text])
    const elapsed = Date.now() - start
    if (elapsed > 200) {
      console.log('[Embedding Perf] Single embed call', {
        textLength: text.length,
        timeMs: elapsed,
        model: this.model,
      })
    }
    return results[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const results: number[][] = new Array(texts.length)
    const batches = [] as Array<{ start: number; texts: string[] }>
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push({ start: i, texts: texts.slice(i, i + this.batchSize) })
    }

    await runWithConcurrency(batches, this.concurrency, async (batch) => {
      const batchResults = await this.callOpenAI(batch.texts)
      for (let j = 0; j < batchResults.length; j++) {
        results[batch.start + j] = batchResults[j]
      }
    })

    return results
  }

  private async callOpenAI(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        encoding_format: 'float',
      }),
    })

    if (!response.ok) {
      const status = response.status
      const errorText = await response.text()

      if (status === 429) {
        throw new Error(
          `嵌入模型 API 限流 (HTTP 429)。建议：1) 在系统设置中将"嵌入并发数"调整为 1；2) 更换支持并发的 API 供应商。原始错误: ${errorText}`
        )
      }

      throw new Error(`OpenAI API error: ${status} ${errorText}`)
    }

    const data = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> }

    if (!data || !Array.isArray(data.data)) {
      throw new Error('Invalid embedding API response: missing data array')
    }

    for (const item of data.data) {
      if (!item || !Array.isArray(item.embedding) || item.embedding.length === 0) {
        throw new Error('Invalid embedding in API response: embedding array is missing or empty')
      }
    }

    const sorted = data.data.sort((a, b) => a.index - b.index)
    return sorted.map((item) => item.embedding)
  }

  getDimension(): number {
    return this.dimension
  }
}

/**
 * Ollama Embedding 提供者
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private apiUrl: string
  private model: string
  private dimension: number
  private concurrency: number

  constructor(config: EmbeddingConfig) {
    this.apiUrl = config.apiUrl || 'http://localhost:11434'
    this.model = config.model || 'nomic-embed-text'
    this.concurrency = Math.max(1, Math.floor(config.concurrency || 1))

    // 常见 Ollama embedding 模型的维度
    const dimensionMap: Record<string, number> = {
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024,
      'all-minilm': 384,
      'snowflake-arctic-embed': 1024,
    }

    this.dimension = dimensionMap[this.model] || 768
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.apiUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Ollama API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as { embedding: number[] }

    // 更新实际维度
    if (data.embedding && data.embedding.length !== this.dimension) {
      this.dimension = data.embedding.length
    }

    return data.embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    // Ollama 不支持批量 embedding，但可以并发调用
    const results: number[][] = new Array(texts.length)
    await runWithConcurrency(texts, this.concurrency, async (text, index) => {
      results[index] = await this.embed(text)
    })
    return results
  }

  getDimension(): number {
    return this.dimension
  }
}

/**
 * 创建 Embedding 提供者
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.engine) {
    case 'openai':
      return new OpenAIEmbeddingProvider(config)
    case 'ollama':
      return new OllamaEmbeddingProvider(config)
    default:
      throw new Error(`Unknown embedding engine: ${config.engine}`)
  }
}

/**
 * Embedding 服务类
 * 提供统一的 embedding 接口，支持配置切换
 */
export class EmbeddingService {
  private provider: EmbeddingProvider
  private config: EmbeddingConfig

  constructor(config: EmbeddingConfig) {
    this.config = config
    this.provider = createEmbeddingProvider(config)
  }

  /**
   * 更新配置并重新创建提供者
   */
  updateConfig(config: EmbeddingConfig): void {
    this.config = config
    this.provider = createEmbeddingProvider(config)
  }

  /**
   * 生成单个文本的 embedding
   */
  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text)
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.provider.embedBatch(texts)
  }

  /**
   * 获取当前 embedding 维度
   */
  getDimension(): number {
    return this.provider.getDimension()
  }

  /**
   * 获取当前配置
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config }
  }
}
