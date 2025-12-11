/**
 * Embedding 服务
 * 支持 OpenAI 和 Ollama 双引擎
 */

export interface EmbeddingConfig {
  engine: 'openai' | 'ollama'
  model: string
  apiKey?: string
  apiUrl?: string
  batchSize?: number
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
  private dimension: number

  constructor(config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required')
    }

    this.apiKey = config.apiKey
    this.apiUrl = config.apiUrl || 'https://api.openai.com/v1'
    this.model = config.model || 'text-embedding-3-small'
    // 默认 batchSize 为 1，因为很多 OpenAI 兼容 API 不支持批量
    this.batchSize = config.batchSize || 1

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
    const results = await this.embedBatch([text])
    return results[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const results: number[][] = []

    // 分批处理
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)
      const batchResults = await this.callOpenAI(batch)
      results.push(...batchResults)
    }

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
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    const data = await response.json()

    // 验证响应格式
    if (!data || !Array.isArray(data.data)) {
      console.error('[Embedding] Unexpected API response format:', JSON.stringify(data).slice(0, 500))
      throw new Error('Invalid embedding API response: missing data array')
    }

    // 检查每个 embedding 是否有效
    for (const item of data.data) {
      if (!item || !Array.isArray(item.embedding) || item.embedding.length === 0) {
        console.error('[Embedding] Invalid embedding item:', JSON.stringify(item).slice(0, 200))
        throw new Error('Invalid embedding in API response: embedding array is missing or empty')
      }
    }

    // 按照原始顺序排序
    const sorted = data.data.sort((a: any, b: any) => a.index - b.index)
    return sorted.map((item: any) => item.embedding)
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

  constructor(config: EmbeddingConfig) {
    this.apiUrl = config.apiUrl || 'http://localhost:11434'
    this.model = config.model || 'nomic-embed-text'

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
    // Ollama 不支持批量 embedding，逐个调用
    const results: number[][] = []
    for (const text of texts) {
      const embedding = await this.embed(text)
      results.push(embedding)
    }
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
