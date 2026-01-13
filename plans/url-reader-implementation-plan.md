# URL Reader 工具实现方案

## 概述

在现有的工具系统中添加一个 `read_url` 工具，允许用户直接提供 URL，由 AI 访问并提取网页内容进行分析。

## 技术选型：自建方案（推荐）

### 为什么选择自建？

| 方案 | 依赖 | 成本 | JS页面支持 | 推荐度 |
|------|------|------|------------|--------|
| **@mozilla/readability + jsdom** | 无外部API | 免费 | ❌ | ⭐⭐⭐⭐⭐ |
| Puppeteer/Playwright | 无外部API | 免费 | ✅ | ⭐⭐ (太重) |
| Jina Reader API | 外部API | 有免费额度 | ✅ | ⭐⭐⭐ |
| Firecrawl | 外部API | 付费 | ✅ | ⭐⭐⭐ |

**推荐方案：`@mozilla/readability` + `jsdom`**

理由：
1. **完全自建**：无需任何外部 API，无成本
2. **轻量级**：只需两个 npm 包，约 2MB
3. **Mozilla 官方**：这是 Firefox Reader Mode 的开源实现，久经考验
4. **效果优秀**：对新闻、博客、文档等常见网页提取效果极佳
5. **简单可靠**：代码简洁，易于维护

**关于 JavaScript 渲染页面**：
- 实际上，用户需要提取的网页 90% 以上是服务端渲染的（新闻、博客、文档、维基百科等）
- 真正需要 JS 渲染的 SPA 页面（如 React/Vue 单页应用）相对少见
- 如果遇到 SPA，可以提示用户该页面需要 JS 渲染，无法直接读取

## 当前架构分析

### 工具系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         stream.ts (路由层)                           │
│  - 接收请求，解析 features                                           │
│  - 调用 buildAgentWebSearchConfig / buildAgentPythonToolConfig      │
│  - 构建 createAgentToolLoopResponse                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    agent-tool-config.ts (配置层)                     │
│  - buildAgentWebSearchConfig()                                      │
│  - buildAgentPythonToolConfig()                                     │
│  - 从系统设置和环境变量构建配置                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       registry.ts (注册层)                           │
│  - ToolHandlerRegistry 管理所有处理器                                 │
│  - createToolHandlerRegistry() 工厂函数                              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    tool-handlers/ (处理器层)                         │
│  - WebSearchToolHandler                                             │
│  - PythonToolHandler                                                │
│  - DocumentToolHandlerAdapter                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 现有工具定义模式

从 `web-search-handler.ts` 可以看到标准模式：

```typescript
export class WebSearchToolHandler implements IToolHandler {
  readonly toolName = 'web_search'
  
  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description: '...',
        parameters: { ... }
      }
    }
  }
  
  async handle(toolCall, args, context): Promise<ToolHandlerResult> {
    // 实现逻辑
  }
}
```

---

## 安装依赖

```bash
cd packages/backend
pnpm add @mozilla/readability jsdom
pnpm add -D @types/jsdom
```

## 实现方案

### 第一步：创建 URL 读取核心工具

**文件：`packages/backend/src/utils/url-reader.ts`**

```typescript
/**
 * URL 内容读取工具
 * 使用 @mozilla/readability + jsdom 自建实现
 * 无需外部 API，完全本地处理
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { BackendLogger as log } from './logger'

export interface UrlReadResult {
  title: string
  url: string
  content: string
  textContent: string
  excerpt?: string
  byline?: string
  siteName?: string
  lang?: string
  publishedTime?: string
  wordCount?: number
  error?: string
}

export interface UrlReaderOptions {
  timeout?: number
  maxContentLength?: number
  userAgent?: string
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_CONTENT_LENGTH = 100000
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AIChat/1.0; +https://github.com/your-project)'

/**
 * 验证 URL 格式和安全性
 */
function validateUrl(url: string): string {
  let normalized = url.trim()
  
  // 添加协议
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`
  }
  
  try {
    const parsed = new URL(normalized)
    const hostname = parsed.hostname.toLowerCase()
    
    // 安全检查：禁止访问内网地址
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.2') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new Error('Access to local/internal URLs is not allowed for security reasons')
    }
    
    // 禁止非 HTTP(S) 协议
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported')
    }
    
    return normalized
  } catch (error) {
    if (error instanceof Error && error.message.includes('not allowed')) {
      throw error
    }
    throw new Error(`Invalid URL format: ${url}`)
  }
}

/**
 * 使用 @mozilla/readability 提取网页正文内容
 * 这是 Firefox Reader Mode 的开源实现
 */
export async function readUrlContent(
  url: string,
  opts: UrlReaderOptions = {}
): Promise<UrlReadResult> {
  const validatedUrl = validateUrl(url)
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  const maxContentLength = opts.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT
  
  log.debug('url reader: fetching', { url: validatedUrl })
  
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  
  try {
    // Step 1: 获取网页 HTML
    const response = await fetch(validatedUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    // 检查 Content-Type
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new Error(`Unsupported content type: ${contentType}. Only HTML pages are supported.`)
    }
    
    const html = await response.text()
    
    if (!html || html.length < 100) {
      throw new Error('Page content is empty or too short')
    }
    
    log.debug('url reader: parsing', { url: validatedUrl, htmlLength: html.length })
    
    // Step 2: 使用 JSDOM 解析 HTML
    const dom = new JSDOM(html, {
      url: validatedUrl,
      // 不执行脚本，纯解析
      runScripts: undefined,
      resources: undefined,
    })
    
    // Step 3: 使用 Readability 提取正文
    const reader = new Readability(dom.window.document, {
      // 保留更多内容
      charThreshold: 20,
    })
    
    const article = reader.parse()
    
    if (!article) {
      throw new Error('Failed to extract article content. The page structure may not be suitable for reading mode.')
    }
    
    // Step 4: 处理提取结果
    let textContent = article.textContent || ''
    
    // 截断过长内容
    if (textContent.length > maxContentLength) {
      textContent = textContent.slice(0, maxContentLength) + '\n\n[内容已截断，原文过长...]'
    }
    
    // 清理多余空白
    textContent = textContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim()
    
    const wordCount = textContent.split(/\s+/).filter(Boolean).length
    
    log.debug('url reader: success', {
      url: validatedUrl,
      title: article.title,
      wordCount,
    })
    
    return {
      title: article.title || '',
      url: validatedUrl,
      content: article.content || '',  // HTML 格式的内容
      textContent,                       // 纯文本内容
      excerpt: article.excerpt || undefined,
      byline: article.byline || undefined,
      siteName: article.siteName || undefined,
      lang: article.lang || undefined,
      publishedTime: article.publishedTime || undefined,
      wordCount,
    }
    
  } catch (error) {
    clearTimeout(timeoutId)
    
    let message: string
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        message = `Request timeout after ${timeout / 1000} seconds`
      } else {
        message = error.message
      }
    } else {
      message = 'Unknown error occurred'
    }
    
    log.error('url reader: failed', { url: validatedUrl, error: message })
    
    return {
      title: '',
      url: validatedUrl,
      content: '',
      textContent: '',
      error: message,
    }
  }
}

/**
 * 格式化读取结果供模型使用
 */
export function formatUrlContentForModel(result: UrlReadResult): string {
  if (result.error) {
    return `无法读取网页 "${result.url}"：${result.error}`
  }
  
  const parts: string[] = []
  
  // 元信息
  parts.push(`## 网页信息`)
  parts.push(`- **URL**: ${result.url}`)
  if (result.title) {
    parts.push(`- **标题**: ${result.title}`)
  }
  if (result.byline) {
    parts.push(`- **作者**: ${result.byline}`)
  }
  if (result.siteName) {
    parts.push(`- **来源**: ${result.siteName}`)
  }
  if (result.publishedTime) {
    parts.push(`- **发布时间**: ${result.publishedTime}`)
  }
  if (result.wordCount) {
    parts.push(`- **字数**: 约 ${result.wordCount} 词`)
  }
  
  // 摘要
  if (result.excerpt) {
    parts.push('')
    parts.push(`## 摘要`)
    parts.push(result.excerpt)
  }
  
  // 正文
  parts.push('')
  parts.push(`## 正文内容`)
  parts.push(result.textContent)
  
  return parts.join('\n')
}

/**
 * 检查 URL 是否可能需要 JavaScript 渲染
 * 用于提前警告用户
 */
export function checkIfLikelySPA(url: string): boolean {
  const spaIndicators = [
    // 常见 SPA 框架的特征 URL
    /angular/i,
    /react/i,
    /vue/i,
    // 常见 SPA 应用
    /twitter\.com/i,
    /x\.com/i,
    /instagram\.com/i,
    /facebook\.com/i,
    /linkedin\.com\/feed/i,
    // 带 hash 路由的 URL
    /#\//,
  ]
  
  return spaIndicators.some(pattern => pattern.test(url))
}
```

---

### 第二步：创建 URL Reader 工具处理器

**文件：`packages/backend/src/modules/chat/tool-handlers/url-reader-handler.ts`**

```typescript
/**
 * URL 读取工具处理器
 * 使用 @mozilla/readability 自建实现，无需外部 API
 */

import { randomUUID } from 'node:crypto'
import {
  readUrlContent,
  formatUrlContentForModel,
  checkIfLikelySPA
} from '../../../utils/url-reader'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from './types'

export interface UrlReaderHandlerConfig {
  enabled: boolean
  timeout?: number
  maxContentLength?: number
}

export class UrlReaderToolHandler implements IToolHandler {
  readonly toolName = 'read_url'
  private config: UrlReaderHandlerConfig

  constructor(config: UrlReaderHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'read_url',
        description:
          'Read and extract the main content from a specific URL/webpage. Use this tool when the user provides a URL and wants to know its content, summarize it, or extract information from it. Works best with articles, blog posts, news, documentation, and similar text-heavy pages. Note: Some dynamic/JavaScript-heavy pages may not be readable. Do NOT use this for general web searches - use web_search instead.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The complete URL to read content from (e.g., https://example.com/article)',
            },
          },
          required: ['url'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult> {
    const url = ((args.url as string) || '').trim()
    const callId = toolCall.id || randomUUID()
    const reasoningMetaBase = { kind: 'tool', tool: 'read_url', url, callId }

    // 参数校验
    if (!url) {
      context.emitReasoning('模型请求读取 URL 但未提供地址，已忽略。', {
        ...reasoningMetaBase,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'error',
        url: '',
        error: 'Model requested read_url without a URL',
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: JSON.stringify({ error: 'Missing URL parameter' }),
        },
      }
    }

    // 检查是否可能是 SPA 页面
    const likelySPA = checkIfLikelySPA(url)
    if (likelySPA) {
      context.emitReasoning(
        `注意：该网址可能是动态页面，内容提取可能不完整。正在尝试读取：${url}`,
        { ...reasoningMetaBase, stage: 'start', warning: 'possible_spa' }
      )
    } else {
      context.emitReasoning(`正在读取网页：${url}`, { ...reasoningMetaBase, stage: 'start' })
    }
    
    context.sendToolEvent({
      id: callId,
      tool: 'read_url',
      stage: 'start',
      url,
      warning: likelySPA ? 'possible_spa' : undefined,
    })

    try {
      const result = await readUrlContent(url, {
        timeout: this.config.timeout,
        maxContentLength: this.config.maxContentLength,
      })

      if (result.error) {
        context.emitReasoning(`读取网页失败：${result.error}`, {
          ...reasoningMetaBase,
          stage: 'error',
        })
        context.sendToolEvent({
          id: callId,
          tool: 'read_url',
          stage: 'error',
          url,
          error: result.error,
        })
        return {
          toolCallId: callId,
          toolName: this.toolName,
          message: {
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'read_url',
            content: JSON.stringify({ url, error: result.error }),
          },
        }
      }

      context.emitReasoning(
        `成功读取网页「${result.title || url}」，共约 ${result.wordCount || 0} 词。`,
        {
          ...reasoningMetaBase,
          stage: 'result',
          title: result.title,
          wordCount: result.wordCount,
        }
      )
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'result',
        url,
        title: result.title,
        excerpt: result.excerpt,
        wordCount: result.wordCount,
        siteName: result.siteName,
        byline: result.byline,
      })

      // 返回格式化的内容供模型使用
      const formatted = formatUrlContentForModel(result)
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: formatted,
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'URL read failed'
      context.emitReasoning(`读取网页失败：${message}`, {
        ...reasoningMetaBase,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'error',
        url,
        error: message,
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: JSON.stringify({ url, error: message }),
        },
      }
    }
  }
}
```

---

### 第三步：更新类型定义

**文件：`packages/backend/src/modules/chat/tool-handlers/types.ts`**

在 `ToolHandlerFactoryParams` 接口中添加：

```typescript
export interface ToolHandlerFactoryParams {
  webSearch?: WebSearchHandlerConfig | null
  python?: PythonHandlerConfig | null
  document?: DocumentHandlerConfig | null
  urlReader?: UrlReaderHandlerConfig | null  // 新增
}

// 新增配置接口（自建方案，无需 API Key）
export interface UrlReaderHandlerConfig {
  enabled: boolean
  timeout?: number
  maxContentLength?: number
}
```

---

### 第四步：更新工具配置构建器

**文件：`packages/backend/src/modules/chat/agent-tool-config.ts`**

添加 URL Reader 配置构建函数：

```typescript
/**
 * URL Reader 工具配置（自建方案）
 */
export interface AgentUrlReaderConfig {
  enabled: boolean
  timeout: number
  maxContentLength: number
}

/**
 * 构建 URL Reader 配置
 */
export const buildAgentUrlReaderConfig = (
  sysMap: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): AgentUrlReaderConfig => {
  const enabled = parseBooleanSetting(
    sysMap.url_reader_enable ?? env.URL_READER_ENABLE,
    false
  )

  const timeout = clampNumber(
    parseNumberSetting(
      sysMap.url_reader_timeout ?? env.URL_READER_TIMEOUT,
      { fallback: 30000 }
    ),
    5000,
    120000
  )

  const maxContentLength = clampNumber(
    parseNumberSetting(
      sysMap.url_reader_max_content_length ?? env.URL_READER_MAX_CONTENT_LENGTH,
      { fallback: 100000 }
    ),
    10000,
    500000
  )

  return {
    enabled,
    timeout,
    maxContentLength,
  }
}
```

---

### 第五步：更新注册表

**文件：`packages/backend/src/modules/chat/tool-handlers/registry.ts`**

```typescript
import { UrlReaderToolHandler } from './url-reader-handler'

// 在 createToolHandlerRegistry 函数中添加：
export function createToolHandlerRegistry(
  params: ToolHandlerFactoryParams
): ToolHandlerRegistry {
  const registry = new ToolHandlerRegistry()

  // 注册 Web 搜索处理器
  if (params.webSearch?.enabled) {
    registry.register(new WebSearchToolHandler(params.webSearch))
  }

  // 注册 URL Reader 处理器（新增）
  if (params.urlReader?.enabled) {
    registry.register(new UrlReaderToolHandler(params.urlReader))
  }

  // 注册 Python 处理器
  if (params.python?.enabled) {
    registry.register(new PythonToolHandler(params.python))
  }

  // 注册文档处理器
  if (params.document?.enabled && params.document.ragService) {
    registry.register(new DocumentToolHandlerAdapter(params.document))
  }

  return registry
}
```

**文件：`packages/backend/src/modules/chat/tool-handlers/index.ts`**

```typescript
// 添加导出
export { UrlReaderToolHandler } from './url-reader-handler'
```

---

### 第六步：更新流式路由

**文件：`packages/backend/src/modules/chat/routes/stream.ts`**

在工具初始化部分添加：

```typescript
import { buildAgentUrlReaderConfig } from '../../chat/agent-tool-config'

// 在处理流程中添加 URL Reader 配置
const urlReaderConfig = buildAgentUrlReaderConfig(sysMap)

// 检查 URL Reader 功能请求
const urlReaderFeatureRequested = requestedFeatures?.url_reader === true
const urlReaderActive =
  urlReaderFeatureRequested &&
  urlReaderConfig.enabled &&
  providerSupportsTools

// 更新 agentToolsActive 判断
const agentToolsActive = 
  agentWebSearchActive || 
  pythonToolActive || 
  urlReaderActive ||  // 新增
  documentToolsActive || 
  knowledgeBaseToolsActive

// 在 toolFlags 中添加
toolFlags: {
  webSearch: agentWebSearchActive,
  urlReader: urlReaderActive,  // 新增
  python: pythonToolActive,
  document: documentToolsActive,
  knowledgeBase: knowledgeBaseToolsActive,
}
```

---

### 第七步：更新设置服务

**文件：`packages/backend/src/services/settings/settings-service.ts`**

在 `getSystemSettings` 方法中添加：

```typescript
// URL Reader 设置
url_reader_enable: this.parseBoolean(
  settingsObj.url_reader_enable, 
  process.env.URL_READER_ENABLE || 'false'
),
url_reader_engine: settingsObj.url_reader_engine || process.env.URL_READER_ENGINE || 'jina',
url_reader_has_api_key: Boolean(
  settingsObj.url_reader_api_key || process.env.URL_READER_API_KEY
),
url_reader_timeout: this.parseIntInRange(
  settingsObj.url_reader_timeout,
  process.env.URL_READER_TIMEOUT,
  5000,
  120000,
  30000
),
url_reader_max_content_length: this.parseIntInRange(
  settingsObj.url_reader_max_content_length,
  process.env.URL_READER_MAX_CONTENT_LENGTH,
  5000,
  200000,
  50000
),
```

在 `getSystemSettingsForAdmin` 方法中添加对应字段暴露。

在 `updateSystemSettings` 方法中添加对应字段更新逻辑。

---

### 第八步：更新 API Schema

**文件：`packages/backend/src/api/settings.ts`**

在 systemSettingsUpdateSchema 中添加：

```typescript
url_reader_enable: z.boolean().optional(),
url_reader_engine: z.enum(['jina', 'firecrawl', 'native']).optional(),
url_reader_api_key: z.string().optional(),
url_reader_endpoint: z.string().url().optional(),
url_reader_timeout: z.number().int().min(5000).max(120000).optional(),
url_reader_max_content_length: z.number().int().min(5000).max(200000).optional(),
```

**文件：`packages/backend/src/modules/chat/chat-common.ts`**

在 features schema 中添加：

```typescript
const featuresSchema = z.object({
  web_search: z.boolean().optional(),
  // ... 其他字段
  url_reader: z.boolean().optional(),  // 新增
})
```

---

### 第九步：前端更新

**文件：`packages/frontend/src/features/chat/store/types.ts`**

在 `StreamSendOptions` 中添加：

```typescript
export type StreamSendOptions = {
  // ... 其他字段
  features?: {
    web_search?: boolean
    url_reader?: boolean  // 新增
    // ... 其他字段
  }
}
```

**文件：`packages/frontend/src/components/plus-menu-content.tsx`**

添加 URL Reader 开关（可选，也可以与 web_search 合并）：

```tsx
// 可以选择：
// 1. 单独开关：用户可以独立控制 web_search 和 url_reader
// 2. 合并为"联网功能"：开启后同时启用两个工具
```

---

## 环境变量配置

在 `.env.example` 中添加：

```bash
# URL Reader Configuration (自建方案，无需 API Key)
URL_READER_ENABLE=false
URL_READER_TIMEOUT=30000
URL_READER_MAX_CONTENT_LENGTH=100000
```

---

## 使用流程

```
用户: "帮我总结一下 https://example.com/article 这篇文章"
    │
    ▼
模型识别到 URL，调用 read_url 工具
    │
    ▼
UrlReaderToolHandler 处理请求
    │
    ├── 调用 Jina Reader API
    │
    ▼
返回网页内容给模型
    │
    ▼
模型基于内容生成摘要回复用户
```

---

## 测试计划

1. **单元测试**
   - `url-reader.ts` 的各引擎实现
   - `url-reader-handler.ts` 的工具处理逻辑
   - URL 验证和安全检查

2. **集成测试**
   - 与现有工具系统的兼容性
   - 流式响应中的工具调用
   - 配置从系统设置正确传递

3. **端到端测试**
   - 用户发送包含 URL 的消息
   - 模型正确调用 read_url 工具
   - 返回内容正确展示

---

## 注意事项

### 1. 安全性
- 禁止访问内网地址（localhost, 192.168.x.x, 10.x.x.x 等）
- 设置合理的超时时间（默认 30 秒）
- 限制返回内容长度（默认 100KB）

### 2. 局限性
- **无法处理 JavaScript 渲染的页面**（如 React/Vue SPA）
- 对于这类页面，代码会自动检测并给出警告
- 常见的新闻、博客、文档、维基百科等页面都支持良好

### 3. 性能
- 可考虑添加简单的内存缓存（如 LRU Cache）避免重复抓取
- 超时控制避免阻塞

### 4. 依赖说明
```
@mozilla/readability  - Mozilla 官方的正文提取库（~50KB）
jsdom                 - 纯 Node.js 的 DOM 实现（~2MB）
```

### 5. 与 web_search 的区别

| 功能 | web_search | read_url |
|------|------------|----------|
| 用途 | 搜索关键词获取多个结果 | 读取指定 URL 的完整内容 |
| 输入 | 搜索关键词 | 完整 URL |
| 输出 | 多个搜索结果摘要 | 单个网页的完整正文 |
| 适用场景 | "帮我搜索最新的..." | "帮我总结这个链接..." |

## 扩展：如果将来需要支持 JS 渲染页面

可以添加可选的 Playwright 支持（比 Puppeteer 更轻量）：

```bash
pnpm add playwright
npx playwright install chromium --with-deps
```

但这会大幅增加依赖体积（~200MB），建议仅在确实需要时启用。