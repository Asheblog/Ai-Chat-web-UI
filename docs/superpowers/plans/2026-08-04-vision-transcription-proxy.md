# 图片转写代理（Vision Transcription Proxy）Implementation Plan

> **Status:** DONE（已合入 `main`，见 CHANGELOG「图片转写代理」与相关提交）。本文件仅作实施档案保留；勾选状态未回溯更新。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户向不支持识图（vision）的主模型发送含图片的消息时，系统自动把图片交给管理员指定的识图模型转写为文字描述，使无识图能力的主模型也能"看懂"图片。

**Architecture:** 混合式——主聊天流处于「工具流」（agent 工具已激活）时注入内置视觉分析工具 `analyze_visual_media`，由主模型自主决定何时、以什么问题调用（可多次按需重问，工具结果随 toolLogsJson 历史持久化）；处于「标准流」（无任何工具）时由后端在发送前自动调用指定视觉模型转写，把描述文本注入用户消息前缀并持久化到 `Message.imageDescriptionsJson`，后续轮次直接复用（转写一次）。配置为系统级全局（系统设置 + 显式开关默认关），管理员选择系统连接 + 该连接下具备 vision 能力的模型。

**Tech Stack:** Node.js 18+ / TypeScript ESM / Hono / Prisma(SQLite) / Jest（backend）；Next.js / Zustand / Vitest（frontend）；pnpm workspace（`@aichat/shared` 共享契约）。

## Global Constraints

- Windows 宿主 + Linux 容器双环境兼容：文件 UTF-8 无 BOM、LF 换行、路径大小写敏感；命令在 Git Bash 下执行。
- 遵循 TDD（先写失败测试 → 实现 → 重构）；后端 Jest（`pnpm --filter backend test`），前端 Vitest（`pnpm --filter frontend test`，CI 用 `vitest run`）。
- 保持既有代码风格：中文注释、双引号/单引号与所在文件一致、不新增大型单体文件（低耦合）。
- 新配置键命名沿用 snake_case 系统设置 + 环境变量回退模式（参考 `title_summary_*`）。
- 不改变有 vision 能力模型的既有行为（历史消息不含图是既有事实，本计划只对无 vision 主模型注入描述）。
- 前端对非 vision 模型加图门禁放宽仅在「转写开关已启用」时生效；未启用则保持现状（禁止加图）。

---

### Task 1: DB 迁移——Message 表新增 imageDescriptionsJson 列

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`（Message model，约 L109-149）
- Create: `packages/backend/prisma/migrations/20260804000000_add_image_descriptions/migration.sql`

**Interfaces:**
- Produces: `Message.imageDescriptionsJson: string | null`（JSON 数组 `[{ description: string; modelRawId: string }]`，按图片顺序）

- [ ] **Step 1: 修改 schema.prisma**

在 `Message` model 的 `toolLogsJson` 字段附近新增：

```prisma
  imageDescriptionsJson String? @map("image_descriptions_json")
```

- [ ] **Step 2: 生成迁移并验证**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter backend exec prisma migrate dev --name add_image_descriptions --create-only
```
Expected: 生成 `prisma/migrations/<ts>_add_image_descriptions/migration.sql`，内容为 `ALTER TABLE "messages" ADD COLUMN "image_descriptions_json" TEXT;`。

- [ ] **Step 3: 将生成的迁移文件重命名为固定名 `20260804000000_add_image_descriptions`（若 prisma 生成的时间戳名不同），并执行迁移**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter backend exec prisma migrate dev
```
Expected: 迁移成功应用，`pnpm --filter backend exec prisma generate` 通过（生成后的 client 含 `imageDescriptionsJson` 字段）。

- [ ] **Step 4: 冒烟验证字段可读写**

在 `packages/backend/src/modules/chat/services/__tests__/vision-proxy-service.test.ts`（本文件在 Task 3 创建，此步仅建最小占位）……不需要。改为直接跑既有测试确认 client 未破坏：

Run: `cd E:/codebase/aichat && pnpm --filter backend test -- --listTests 2>&1 | head -5`
Expected: jest 正常列出测试（client 生成成功）。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma && git commit -m "feat(vision-proxy): add image_descriptions_json column to messages"
```

---

### Task 2: 共享能力判定工具 utils/model-capabilities.ts

从 `agent-web-search-response.ts` 抽取 `resolveModelCapabilities` 为共享函数（use-case 与 agent 流共用，避免两处判定分叉）。

**Files:**
- Create: `packages/backend/src/utils/model-capabilities.ts`
- Modify: `packages/backend/src/modules/chat/agent-web-search-response.ts`（删除本地实现，改 import）
- Test: `packages/backend/src/utils/__tests__/model-capabilities.test.ts`

**Interfaces:**
- Produces:
```ts
export function resolveModelCapabilitiesForSession(
  prisma: PrismaClient,
  session: { connectionId?: number | null; modelRawId?: string | null },
): Promise<CapabilityFlags>  // CapabilityFlags 来自 utils/capabilities.ts：{ vision?: boolean; image_generation?: boolean }
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/backend/src/utils/__tests__/model-capabilities.test.ts
import { resolveModelCapabilitiesForSession } from '../model-capabilities'

const prisma = {
  modelCatalog: {
    findFirst: jest.fn(),
  },
} as any

describe('resolveModelCapabilitiesForSession', () => {
  it('returns capabilitiesJson flags when stored', async () => {
    prisma.modelCatalog.findFirst.mockResolvedValue({
      capabilitiesJson: JSON.stringify({ vision: false, image_generation: true }),
      tagsJson: '[]',
    })
    const flags = await resolveModelCapabilitiesForSession(prisma, { connectionId: 1, modelRawId: 'gpt-4o' })
    expect(flags).toEqual({ vision: false, image_generation: true })
  })

  it('falls back to heuristics when no stored capabilities', async () => {
    prisma.modelCatalog.findFirst.mockResolvedValue(null)
    const flags = await resolveModelCapabilitiesForSession(prisma, { connectionId: 1, modelRawId: 'qwen-vl-max' })
    expect(flags.vision).toBe(true)
  })

  it('returns empty flags when session has no connection', async () => {
    const flags = await resolveModelCapabilitiesForSession(prisma, { connectionId: null, modelRawId: '' })
    expect(flags.vision).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/utils/__tests__/model-capabilities.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// packages/backend/src/utils/model-capabilities.ts
import type { PrismaClient } from '@prisma/client'
import { computeCapabilities } from './providers'
import { parseCapabilityEnvelope, type CapabilityFlags } from './capabilities'

/**
 * 解析会话主模型的视觉/生图能力：优先取 ModelCatalog.capabilitiesJson，
 * 缺失时按模型 ID/标签启发式判定（与 agent 流 resolveModelCapabilities 同逻辑）。
 */
export async function resolveModelCapabilitiesForSession(
  prisma: PrismaClient,
  session: { connectionId?: number | null; modelRawId?: string | null },
): Promise<CapabilityFlags> {
  const connectionId = session.connectionId ?? null
  const rawModelId = session.modelRawId || ''
  if (!connectionId || !rawModelId) {
    return computeCapabilities(rawModelId, [])
  }
  try {
    const catalog = await prisma.modelCatalog.findFirst({
      where: { connectionId, rawId: rawModelId },
      select: { capabilitiesJson: true, tagsJson: true },
    })
    const parsed = parseCapabilityEnvelope(catalog?.capabilitiesJson)
    if (parsed?.flags) {
      return parsed.flags
    }
    const tags = (() => {
      try {
        const value = JSON.parse(catalog?.tagsJson || '[]')
        return Array.isArray(value) ? value : []
      } catch {
        return []
      }
    })()
    return computeCapabilities(rawModelId, tags)
  } catch {
    return computeCapabilities(rawModelId, [])
  }
}
```

- [ ] **Step 4: 改造 agent-web-search-response.ts 复用**

删除 `agent-web-search-response.ts` L72-106 的本地 `resolveModelCapabilities`，改为：

```ts
import { resolveModelCapabilitiesForSession } from '../../utils/model-capabilities'
```
调用处（L604 `const modelCapabilities = await resolveModelCapabilities(session)`）改为：
```ts
const modelCapabilities = await resolveModelCapabilitiesForSession(prisma, session)
```
（`computeCapabilities`、`parseCapabilityEnvelope` 的 import 若无他用则一并删除。）

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter backend exec jest src/utils/__tests__/model-capabilities.test.ts
pnpm --filter backend exec jest src/modules/chat/agent-web-search-response.test.ts 2>/dev/null || true
pnpm --filter backend exec jest src/modules/chat/__tests__/document-tools.test.ts
```
Expected: 新测试 PASS；既有 agent 相关测试不回归（若 `agent-web-search-response.test.ts` 不存在则跳过）。

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/utils/model-capabilities.ts packages/backend/src/utils/__tests__/model-capabilities.test.ts packages/backend/src/modules/chat/agent-web-search-response.ts
git commit -m "refactor(vision-proxy): extract resolveModelCapabilitiesForSession to shared util"
```

---

### Task 3: VisionProxyService（配置解析 + 直连转写调用）

**Files:**
- Create: `packages/backend/src/modules/chat/services/vision-proxy-service.ts`
- Test: `packages/backend/src/modules/chat/services/__tests__/vision-proxy-service.test.ts`

**Interfaces:**
- Produces:
```ts
export interface VisionProxyConfig { enabled: boolean; connectionId: number | null; modelId: string | null }
export interface ImageDescription { description: string; modelRawId: string }
export class VisionProxyServiceError extends Error { statusCode: number }
export function loadVisionProxyConfig(sysMap: Record<string, string>): VisionProxyConfig
export function isVisionProxyReady(config: VisionProxyConfig): boolean
export function parseStoredImageDescriptions(json: string | null | undefined): ImageDescription[] | null
export async function loadHistoryImageDescriptions(prisma: PrismaClient, sessionId: number, historyUpperBound: Date | null): Promise<Map<number, ImageDescription[]>>
export class VisionProxyService {
  constructor(deps?: { prisma?: PrismaClient; secretVault?: SecretVaultService; fetchFn?: typeof fetch })
  async transcribeImages(images: Array<{ data: string; mime: string }>, question: string, config: VisionProxyConfig): Promise<{ description: string; modelRawId: string }>
}
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/backend/src/modules/chat/services/__tests__/vision-proxy-service.test.ts
import {
  VisionProxyService,
  VisionProxyServiceError,
  loadVisionProxyConfig,
  isVisionProxyReady,
  parseStoredImageDescriptions,
  loadHistoryImageDescriptions,
} from '../vision-proxy-service'

const prisma = {
  connection: { findUnique: jest.fn() },
  message: { findMany: jest.fn() },
} as any

const config = { enabled: true, connectionId: 1, modelId: 'qwen-vl-max' }
const images = [{ data: 'aGVsbG8=', mime: 'image/png' }]

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response

describe('loadVisionProxyConfig', () => {
  it('parses sysMap with env fallback', () => {
    const cfg = loadVisionProxyConfig({ image_transcription_enabled: 'true', image_transcription_connection_id: '3', image_transcription_model_id: 'gpt-4o' })
    expect(cfg).toEqual({ enabled: true, connectionId: 3, modelId: 'gpt-4o' })
  })
  it('disabled by default', () => {
    expect(loadVisionProxyConfig({}).enabled).toBe(false)
  })
})

describe('isVisionProxyReady', () => {
  it('requires enabled + connectionId + modelId', () => {
    expect(isVisionProxyReady({ enabled: true, connectionId: 1, modelId: 'm' })).toBe(true)
    expect(isVisionProxyReady({ enabled: false, connectionId: 1, modelId: 'm' })).toBe(false)
    expect(isVisionProxyReady({ enabled: true, connectionId: null, modelId: 'm' })).toBe(false)
    expect(isVisionProxyReady({ enabled: true, connectionId: 1, modelId: null })).toBe(false)
  })
})

describe('parseStoredImageDescriptions', () => {
  it('parses valid json, returns null otherwise', () => {
    expect(parseStoredImageDescriptions('[{"description":"一只猫","modelRawId":"qwen-vl-max"}]')).toEqual([{ description: '一只猫', modelRawId: 'qwen-vl-max' }])
    expect(parseStoredImageDescriptions(null)).toBeNull()
    expect(parseStoredImageDescriptions('bad')).toBeNull()
    expect(parseStoredImageDescriptions('[]')).toBeNull()
  })
})

describe('loadHistoryImageDescriptions', () => {
  it('maps messageId to parsed descriptions', async () => {
    prisma.message.findMany.mockResolvedValue([
      { id: 5, imageDescriptionsJson: '[{"description":"d1","modelRawId":"m"}]' },
      { id: 6, imageDescriptionsJson: 'bad' },
    ])
    const map = await loadHistoryImageDescriptions(prisma, 1, null)
    expect(map.get(5)).toEqual([{ description: 'd1', modelRawId: 'm' }])
    expect(map.has(6)).toBe(false)
  })
})

describe('VisionProxyService.transcribeImages', () => {
  const service = () => new VisionProxyService({ prisma, fetchFn: jest.fn() })

  it('throws 400 when config not ready', async () => {
    await expect(service().transcribeImages(images, '', { enabled: true, connectionId: null, modelId: null }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 404 when connection missing', async () => {
    prisma.connection.findUnique.mockResolvedValue(null)
    await expect(service().transcribeImages(images, '', config)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns description from openai-format response', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '  图片里有一只猫  ' } }] }))
    const result = await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '这是什么？', config)
    expect(result.description).toBe('图片里有一只猫')
    expect(result.modelRawId).toBe('qwen-vl-max')
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toContain('/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('qwen-vl-max')
    expect(body.messages[1].content[0].text).toContain('这是什么')
    expect(body.messages[1].content[1].image_url.url).toContain('data:image/png;base64,')
  })

  it('parses google_genai response', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'google_genai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }))
    const result = await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)
    expect(result.description).toBe('ab')
  })

  it('maps http error to 502 VisionProxyServiceError', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toMatchObject({ statusCode: 502 })
  })

  it('throws 502 on empty description', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '   ' } }] }))
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toMatchObject({ statusCode: 502 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/services/__tests__/vision-proxy-service.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// packages/backend/src/modules/chat/services/vision-proxy-service.ts
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import type { SecretVaultService } from '../../../services/secret-vault'
import { buildHeaders, type ProviderType, type AuthType } from '../../../utils/providers'
import { convertChatCompletionsRequestToResponses, extractTextFromResponsesResponse } from '../../../utils/openai-responses'
import { BackendLogger as log } from '../../../utils/logger'

export interface VisionProxyConfig {
  enabled: boolean
  connectionId: number | null
  modelId: string | null
}

export interface ImageDescription {
  description: string
  modelRawId: string
}

export class VisionProxyServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'VisionProxyServiceError'
    this.statusCode = statusCode
  }
}

const TRANSCRIPTION_SYSTEM_PROMPT =
  '你是一个图片描述助手。请尽可能详细地描述图片内容，包括：主要物体/人物、可见的文字内容（保留原文）、颜色、布局、数量、场景与氛围等一切可见细节。如有多个图片请分别说明。只输出描述文本，不要使用 Markdown 格式。'

export function loadVisionProxyConfig(sysMap: Record<string, string>): VisionProxyConfig {
  const enabled = (sysMap.image_transcription_enabled ?? process.env.IMAGE_TRANSCRIPTION_ENABLED ?? 'false')
    .toString()
    .toLowerCase() === 'true'
  const connectionIdRaw = sysMap.image_transcription_connection_id ?? process.env.IMAGE_TRANSCRIPTION_CONNECTION_ID ?? ''
  const connectionId = connectionIdRaw ? Number(connectionIdRaw) || null : null
  const modelIdRaw = sysMap.image_transcription_model_id ?? process.env.IMAGE_TRANSCRIPTION_MODEL_ID ?? ''
  const modelId = modelIdRaw ? modelIdRaw.toString().trim() || null : null
  return { enabled, connectionId, modelId }
}

export function isVisionProxyReady(config: VisionProxyConfig): boolean {
  return config.enabled && config.connectionId != null && Boolean(config.modelId)
}

export function parseStoredImageDescriptions(json: string | null | undefined): ImageDescription[] | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export async function loadHistoryImageDescriptions(
  prisma: PrismaClient,
  sessionId: number,
  historyUpperBound: Date | null,
): Promise<Map<number, ImageDescription[]>> {
  const rows = await prisma.message.findMany({
    where: {
      sessionId,
      role: 'user',
      imageDescriptionsJson: { not: null },
      ...(historyUpperBound ? { createdAt: { lte: historyUpperBound } } : {}),
    },
    select: { id: true, imageDescriptionsJson: true },
  })
  const result = new Map<number, ImageDescription[]>()
  for (const row of rows) {
    const parsed = parseStoredImageDescriptions(row.imageDescriptionsJson)
    if (parsed) {
      result.set(row.id, parsed)
    }
  }
  return result
}

export interface VisionProxyServiceDeps {
  prisma?: PrismaClient
  secretVault?: SecretVaultService
  fetchFn?: typeof fetch
}

export class VisionProxyService {
  private prisma: PrismaClient
  private secretVault?: SecretVaultService
  private fetchFn: typeof fetch

  constructor(deps: VisionProxyServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.secretVault = deps.secretVault
    this.fetchFn = deps.fetchFn ?? fetch
  }

  /**
   * 调用指定 vision 模型转写图片为文字描述（直连模式，参考 title-summary-service）
   */
  async transcribeImages(
    images: Array<{ data: string; mime: string }>,
    question: string,
    config: VisionProxyConfig,
  ): Promise<{ description: string; modelRawId: string }> {
    if (!isVisionProxyReady(config)) {
      throw new VisionProxyServiceError('图片转写代理未配置（请管理员在系统设置中配置转写模型）', 400)
    }
    if (!Array.isArray(images) || images.length === 0) {
      throw new VisionProxyServiceError('没有可转写的图片', 400)
    }
    const connection = await this.prisma.connection.findUnique({
      where: { id: config.connectionId! },
    })
    if (!connection) {
      throw new VisionProxyServiceError('图片转写代理的连接不存在，请检查系统设置', 404)
    }
    const modelId = config.modelId!
    const provider = connection.provider as ProviderType
    const endpoint = (connection.baseUrl || '').trim().replace(/\/+$/, '')
    const authType = connection.authType as AuthType
    let apiKey = ''
    if (authType === 'bearer' && (connection as any).secretVaultId && this.secretVault) {
      apiKey = await this.secretVault.decryptById((connection as any).secretVaultId).catch(() => {
        throw new VisionProxyServiceError('图片转写代理的 API Key 解密失败', 502)
      })
    }
    if (!endpoint) {
      throw new VisionProxyServiceError('图片转写代理的连接未配置 baseUrl', 400)
    }

    let extraHeaders: Record<string, string> | undefined
    try {
      if (connection.headersJson && connection.headersJson.trim()) {
        extraHeaders = JSON.parse(connection.headersJson)
      }
    } catch {
      // ignore invalid JSON
    }

    const userText = `请描述以上图片。${question?.trim() ? `\n用户问题：${question.trim()}` : ''}`
    const parts: Array<Record<string, unknown>> = [{ type: 'text', text: userText }]
    for (const image of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.data}` },
      })
    }
    const messages = [
      { role: 'system', content: TRANSCRIPTION_SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ]
    const chatBody: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: 0.2,
      max_tokens: 2000,
      stream: false,
    }
    const body = provider === 'openai_responses' ? convertChatCompletionsRequestToResponses(chatBody) : chatBody
    const headers = await buildHeaders(provider, authType, apiKey, extraHeaders)

    let url: string
    if (provider === 'ollama') {
      url = `${endpoint}/api/chat`
    } else if (provider === 'azure_openai') {
      const apiVersion = connection.azureApiVersion || '2024-02-15-preview'
      url = `${endpoint}/openai/deployments/${encodeURIComponent(modelId)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    } else if (provider === 'openai_responses') {
      url = `${endpoint}/responses`
    } else if (provider === 'google_genai') {
      url = `${endpoint}/models/${encodeURIComponent(modelId)}:generateContent`
    } else {
      url = `${endpoint}/chat/completions`
    }

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        log.warn('[vision-proxy] provider request failed', {
          status: response.status,
          url,
          error: errorText.slice(0, 200),
        })
        throw new VisionProxyServiceError(`转写模型请求失败（HTTP ${response.status}）`, 502)
      }
      const rawText = await response.text()
      let json: any = {}
      try {
        json = JSON.parse(rawText)
      } catch {
        // ignore parse error
      }
      let text = ''
      if (provider === 'openai_responses') {
        text = extractTextFromResponsesResponse(json) || ''
      } else if (provider === 'google_genai') {
        text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
      } else {
        text =
          json?.choices?.[0]?.message?.content ||
          json?.choices?.[0]?.message?.reasoning_content ||
          json?.message?.content ||
          ''
      }
      text = text.trim()
      if (!text) {
        throw new VisionProxyServiceError('转写模型返回了空描述', 502)
      }
      log.info('[vision-proxy] transcription completed', {
        images: images.length,
        modelRawId: modelId,
        descriptionLength: text.length,
      })
      return { description: text, modelRawId: modelId }
    } catch (error) {
      if (error instanceof VisionProxyServiceError) {
        throw error
      }
      log.error('[vision-proxy] unexpected error', { error })
      throw new VisionProxyServiceError(
        `图片转写失败：${error instanceof Error ? error.message : String(error)}`,
        502,
      )
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/services/__tests__/vision-proxy-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/chat/services/vision-proxy-service.ts packages/backend/src/modules/chat/services/__tests__/vision-proxy-service.test.ts
git commit -m "feat(vision-proxy): add VisionProxyService for image transcription"
```

---

### Task 4: 视觉分析工具处理器 analyze_visual_media

**Files:**
- Create: `packages/backend/src/modules/chat/tool-handlers/vision-proxy-handler.ts`
- Modify: `packages/backend/src/modules/chat/tool-handlers/types.ts`（ToolHandlerFactoryParams 加 visionProxy）
- Modify: `packages/backend/src/modules/chat/tool-handlers/registry.ts`（工厂注册）
- Test: `packages/backend/src/modules/chat/tool-handlers/__tests__/vision-proxy-handler.test.ts`

**Interfaces:**
- Consumes: `VisionProxyConfig`, `VisionProxyService`（Task 3）
- Produces:
```ts
export class VisionProxyToolHandler implements IToolHandler {
  constructor(config: VisionProxyConfig, service?: VisionProxyService)
  readonly toolName: 'analyze_visual_media'
}
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/backend/src/modules/chat/tool-handlers/__tests__/vision-proxy-handler.test.ts
import { VisionProxyToolHandler } from '../vision-proxy-handler'
import { VisionProxyServiceError } from '../../services/vision-proxy-service'

jest.mock('../../../../utils/chat-images', () => ({
  loadPersistedChatImages: jest.fn(),
}))

import { loadPersistedChatImages } from '../../../../utils/chat-images'

const config = { enabled: true, connectionId: 1, modelId: 'qwen-vl-max' }
const context = {
  sessionId: 1,
  messageId: 100,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
} as any

const makeService = (impl: Partial<VisionProxyService>): any => ({
  transcribeImages: jest.fn(),
  ...impl,
})

describe('VisionProxyToolHandler', () => {
  it('exposes toolName and definition', () => {
    const handler = new VisionProxyToolHandler(config)
    expect(handler.toolName).toBe('analyze_visual_media')
    expect(handler.canHandle('analyze_visual_media')).toBe(true)
    expect(handler.toolDefinition.function.name).toBe('analyze_visual_media')
  })

  it('returns error result when messageId missing', async () => {
    const handler = new VisionProxyToolHandler(config, makeService({}))
    const result = await handler.handle({ id: 'tc1' }, {}, { ...context, messageId: null })
    expect(result.message.content).toContain('无法定位当前消息')
  })

  it('returns error result when no persisted images', async () => {
    ;(loadPersistedChatImages as jest.Mock).mockResolvedValue([])
    const handler = new VisionProxyToolHandler(config, makeService({}))
    const result = await handler.handle({ id: 'tc1' }, {}, context)
    expect(result.message.content).toContain('没有可分析的图片')
  })

  it('returns description from service as tool result', async () => {
    ;(loadPersistedChatImages as jest.Mock).mockResolvedValue([{ data: 'aGk=', mime: 'image/png' }])
    const service = makeService({ transcribeImages: jest.fn().mockResolvedValue({ description: '图片里有一只猫', modelRawId: 'qwen-vl-max' }) })
    const handler = new VisionProxyToolHandler(config, service)
    const result = await handler.handle({ id: 'tc1' }, { question: '这是什么' }, context)
    expect(service.transcribeImages).toHaveBeenCalledWith([{ data: 'aGk=', mime: 'image/png' }], '这是什么', config)
    expect(result.message.role).toBe('tool')
    expect(result.message.content).toContain('图片里有一只猫')
    expect(result.message.content).toContain('qwen-vl-max')
  })

  it('returns error text when service throws', async () => {
    ;(loadPersistedChatImages as jest.Mock).mockResolvedValue([{ data: 'aGk=', mime: 'image/png' }])
    const service = makeService({ transcribeImages: jest.fn().mockRejectedValue(new VisionProxyServiceError('配额不足', 502)) })
    const handler = new VisionProxyToolHandler(config, service)
    const result = await handler.handle({ id: 'tc1' }, {}, context)
    expect(result.message.content).toContain('图片转写失败')
    expect(result.message.content).toContain('配额不足')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/tool-handlers/__tests__/vision-proxy-handler.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 handler**

```ts
// packages/backend/src/modules/chat/tool-handlers/vision-proxy-handler.ts
import type { IToolHandler, ToolCall, ToolCallContext, ToolDefinition, ToolHandlerResult } from './types'
import { loadPersistedChatImages } from '../../../utils/chat-images'
import { VisionProxyService, type VisionProxyConfig } from '../services/vision-proxy-service'

/**
 * 视觉分析工具——主模型无 vision 时由主模型自主调用，
 * 读取当前消息附件图片并交给指定 vision 模型转写，描述作为工具结果回传。
 */
export class VisionProxyToolHandler implements IToolHandler {
  readonly toolName = 'analyze_visual_media'
  private service: VisionProxyService

  constructor(private config: VisionProxyConfig, service?: VisionProxyService) {
    this.service = service ?? new VisionProxyService()
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.toolName,
        description:
          '分析当前用户消息中的图片内容，返回图片的文字描述。当用户发送了图片、或回答需要理解图片内容时调用此工具。图片取自当前消息附件，无需在参数中传递图片。工具返回后请直接依据描述回答用户。',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: '针对图片的具体问题（可选）；留空则返回完整描述',
            },
          },
          required: [],
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
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const toolCallId = toolCall.id ?? ''
    const question = typeof args?.question === 'string' ? args.question : ''
    const fail = (error: string): ToolHandlerResult => ({
      toolCallId,
      toolName: this.toolName,
      message: { role: 'tool', tool_call_id: toolCallId, name: this.toolName, content: error },
    })

    if (!context.messageId) {
      return fail('无法定位当前消息，请重试')
    }
    let images: Array<{ data: string; mime: string }>
    try {
      images = await loadPersistedChatImages(context.messageId)
    } catch {
      return fail('读取图片失败，请重试')
    }
    if (!Array.isArray(images) || images.length === 0) {
      return fail('当前消息没有可分析的图片')
    }
    try {
      const { description, modelRawId } = await this.service.transcribeImages(images, question, this.config)
      return {
        toolCallId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCallId,
          name: this.toolName,
          content: `图片描述（由 ${modelRawId} 转写）：\n${description}`,
        },
      }
    } catch (error) {
      return fail(`图片转写失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
```

- [ ] **Step 4: types.ts 加配置**

`packages/backend/src/modules/chat/tool-handlers/types.ts`，在 `ToolHandlerFactoryParams`（L99-106）加：

```ts
  visionProxy?: VisionProxyConfig | null
```
顶部加 import：`import type { VisionProxyConfig } from '../services/vision-proxy-service'`

- [ ] **Step 5: registry.ts 工厂注册**

`packages/backend/src/modules/chat/tool-handlers/registry.ts`：
- 顶部 import：`import { VisionProxyToolHandler } from './vision-proxy-handler'`
- `createToolHandlerRegistry` 签名改为：`createToolHandlerRegistry(params: ToolHandlerFactoryParams, deps: { visionProxyService?: VisionProxyService } = {})`
- import 类型 `VisionProxyService`（`import type { VisionProxyService } from '../services/vision-proxy-service'`）
- 在函数末尾（knowledgeBase 注册后）加：

```ts
  // 注册视觉分析工具处理器（图片转写代理）
  if (params.visionProxy?.enabled) {
    registry.register(new VisionProxyToolHandler(params.visionProxy, deps.visionProxyService))
  }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/tool-handlers/__tests__/vision-proxy-handler.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/chat/tool-handlers/vision-proxy-handler.ts packages/backend/src/modules/chat/tool-handlers/__tests__/vision-proxy-handler.test.ts packages/backend/src/modules/chat/tool-handlers/types.ts packages/backend/src/modules/chat/tool-handlers/registry.ts
git commit -m "feat(vision-proxy): add analyze_visual_media tool handler"
```

---

### Task 5: agent-tool-config 扩展（配置构建器 + 工具标志计算抽取）

**Files:**
- Modify: `packages/backend/src/modules/chat/agent-tool-config.ts`
- Test: `packages/backend/src/modules/chat/__tests__/agent-tool-config.test.ts`（新建）

**Interfaces:**
- Produces:
```ts
export interface AgentVisionProxyConfig extends VisionProxyConfig {}
export function buildAgentVisionProxyConfig(sysMap: Record<string, string>): AgentVisionProxyConfig
export interface AgentToolFlagsInput {
  sysMap: Record<string, string>
  requestedSkills: RequestedSkillsPayload
  hasKnowledgeBases: boolean
  webSearchConfig: AgentWebSearchConfig
  pythonToolConfig: AgentPythonToolConfig
  workspaceToolConfig: AgentWorkspaceToolConfig
  urlReaderConfig: AgentUrlReaderConfig
}
export interface AgentToolFlags { /* 见下方实现 */ }
export function computeAgentToolFlags(input: AgentToolFlagsInput): AgentToolFlags
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/backend/src/modules/chat/__tests__/agent-tool-config.test.ts
import { buildAgentVisionProxyConfig, computeAgentToolFlags } from '../agent-tool-config'
import type { AgentWebSearchConfig, AgentPythonToolConfig, AgentWorkspaceToolConfig, AgentUrlReaderConfig } from '../agent-tool-config'
import { BUILTIN_SKILL_SLUGS } from '../../skills/types'

const webSearchConfig: AgentWebSearchConfig = {
  enabled: true, engines: ['tavily'], engineOrder: ['tavily'], apiKeys: { tavily: 'k' },
  resultLimit: 5, domains: [], parallelMaxEngines: 2, parallelMaxQueriesPerCall: 1,
  parallelTimeoutMs: 15000, mergeStrategy: 'hybrid_score_v1', autoBilingual: false,
  autoBilingualMode: 'off',
}
const pythonToolConfig: AgentPythonToolConfig = { enabled: true, timeoutMs: 60000, maxOutputChars: 20000, maxSourceChars: 20000 }
const workspaceToolConfig: AgentWorkspaceToolConfig = { enabled: true, listMaxEntries: 50, readMaxChars: 20000, gitCloneTimeoutMs: 60000 }
const urlReaderConfig: AgentUrlReaderConfig = { enabled: true, timeout: 30000 }

describe('buildAgentVisionProxyConfig', () => {
  it('parses sysMap', () => {
    const cfg = buildAgentVisionProxyConfig({
      image_transcription_enabled: 'true',
      image_transcription_connection_id: '2',
      image_transcription_model_id: 'gemini-2.5-flash',
    })
    expect(cfg).toEqual({ enabled: true, connectionId: 2, modelId: 'gemini-2.5-flash' })
  })
  it('disabled when absent', () => {
    expect(buildAgentVisionProxyConfig({}).enabled).toBe(false)
  })
})

describe('computeAgentToolFlags', () => {
  const base = {
    sysMap: {},
    requestedSkills: { builtin: [], enabled: [] } as any,
    hasKnowledgeBases: false,
    webSearchConfig,
    pythonToolConfig,
    workspaceToolConfig,
    urlReaderConfig,
  }

  it('no tools active by default', () => {
    const flags = computeAgentToolFlags(base)
    expect(flags.agentToolsActive).toBe(false)
  })

  it('web search active when requested and configured', () => {
    const flags = computeAgentToolFlags({
      ...base,
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.WEB_SEARCH], enabled: [] } as any,
    })
    expect(flags.agentWebSearchActive).toBe(true)
    expect(flags.agentToolsActive).toBe(true)
  })

  it('web search inactive when no api keys', () => {
    const flags = computeAgentToolFlags({
      ...base,
      webSearchConfig: { ...webSearchConfig, apiKeys: {} },
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.WEB_SEARCH], enabled: [] } as any,
    })
    expect(flags.agentWebSearchActive).toBe(false)
  })

  it('url reader active when requested', () => {
    const flags = computeAgentToolFlags({
      ...base,
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.URL_READER], enabled: [] } as any,
    })
    expect(flags.urlReaderActive).toBe(true)
  })

  it('dynamic skill requires runtime enabled', () => {
    const flags = computeAgentToolFlags({
      ...base,
      sysMap: { chat_dynamic_skill_runtime_enabled: 'false' },
      requestedSkills: { builtin: [], enabled: [{ skillId: 1 }] } as any,
    })
    expect(flags.dynamicSkillRequested).toBe(false)
    const flags2 = computeAgentToolFlags({
      ...base,
      sysMap: { chat_dynamic_skill_runtime_enabled: 'true' },
      requestedSkills: { builtin: [], enabled: [{ skillId: 1 }] } as any,
    })
    expect(flags2.dynamicSkillRequested).toBe(true)
    expect(flags2.agentToolsActive).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/__tests__/agent-tool-config.test.ts`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 实现**

在 `agent-tool-config.ts` 末尾追加（顶部补 import：`import { BUILTIN_SKILL_SLUGS } from '../../skills/types'`、`import type { RequestedSkillsPayload } from '../../skills/types'`、`import { loadVisionProxyConfig, type VisionProxyConfig } from '../services/vision-proxy-service'`；确认无循环依赖——`vision-proxy-service` 不依赖 tool-handlers）：

```ts
/**
 * 图片转写代理配置（vision 代理模型）
 */
export interface AgentVisionProxyConfig extends VisionProxyConfig {}

export function buildAgentVisionProxyConfig(sysMap: Record<string, string>): AgentVisionProxyConfig {
  return loadVisionProxyConfig(sysMap)
}
```

```ts
export interface AgentToolFlags {
  webSearchSkillRequested: boolean
  pythonSkillRequested: boolean
  urlReaderSkillRequested: boolean
  knowledgeBaseSkillRequested: boolean
  webSearchEnginesWithKeys: string[]
  agentWebSearchActive: boolean
  pythonToolActive: boolean
  workspaceToolsActive: boolean
  urlReaderActive: boolean
  documentToolsActive: boolean
  knowledgeBaseToolsActive: boolean
  dynamicSkillRequestedRaw: boolean
  dynamicSkillRuntimeEnabled: boolean
  dynamicSkillRequested: boolean
  agentToolsActive: boolean
}

export interface AgentToolFlagsInput {
  sysMap: Record<string, string>
  requestedSkills: RequestedSkillsPayload
  hasKnowledgeBases: boolean
  webSearchConfig: AgentWebSearchConfig
  pythonToolConfig: AgentPythonToolConfig
  workspaceToolConfig: AgentWorkspaceToolConfig
  urlReaderConfig: AgentUrlReaderConfig
}

/**
 * 计算当前请求的工具流标志（从 chat-stream-use-case 抽取，供决策与请求前预判共用）
 */
export function computeAgentToolFlags(input: AgentToolFlagsInput): AgentToolFlags {
  const { sysMap, requestedSkills, hasKnowledgeBases } = input
  const webSearchSkillRequested = requestedSkills.builtin.includes(BUILTIN_SKILL_SLUGS.WEB_SEARCH)
  const pythonSkillRequested = requestedSkills.builtin.includes(BUILTIN_SKILL_SLUGS.PYTHON_RUNNER)
  const urlReaderSkillRequested =
    requestedSkills.builtin.includes(BUILTIN_SKILL_SLUGS.URL_READER) || webSearchSkillRequested
  const knowledgeBaseSkillRequested =
    requestedSkills.builtin.includes(BUILTIN_SKILL_SLUGS.KNOWLEDGE_BASE_SEARCH) || hasKnowledgeBases
  const webSearchEnginesWithKeys = (input.webSearchConfig.engines || []).filter((engine) =>
    Boolean(input.webSearchConfig.apiKeys?.[engine]),
  )
  const agentWebSearchActive =
    webSearchSkillRequested && input.webSearchConfig.enabled && webSearchEnginesWithKeys.length > 0
  const pythonToolActive = pythonSkillRequested && input.pythonToolConfig.enabled
  const workspaceToolsActive = pythonToolActive && input.workspaceToolConfig.enabled
  const urlReaderActive = urlReaderSkillRequested
  // 会话文档工具已废弃（改为 workspace 直接文件访问），保留仅用于兼容
  const documentToolsActive = false
  const knowledgeBaseToolsActive = knowledgeBaseSkillRequested && hasKnowledgeBases
  const dynamicSkillRequestedRaw = requestedSkills.enabled.length > 0
  const dynamicSkillRuntimeEnabled =
    (sysMap.chat_dynamic_skill_runtime_enabled ||
      process.env.CHAT_DYNAMIC_SKILL_RUNTIME_ENABLED ||
      'false')
      .toString()
      .toLowerCase() === 'true'
  const dynamicSkillRequested = dynamicSkillRequestedRaw && dynamicSkillRuntimeEnabled
  const agentToolsActive =
    agentWebSearchActive ||
    pythonToolActive ||
    workspaceToolsActive ||
    urlReaderActive ||
    documentToolsActive ||
    knowledgeBaseToolsActive ||
    dynamicSkillRequested
  return {
    webSearchSkillRequested,
    pythonSkillRequested,
    urlReaderSkillRequested,
    knowledgeBaseSkillRequested,
    webSearchEnginesWithKeys,
    agentWebSearchActive,
    pythonToolActive,
    workspaceToolsActive,
    urlReaderActive,
    documentToolsActive,
    knowledgeBaseToolsActive,
    dynamicSkillRequestedRaw,
    dynamicSkillRuntimeEnabled,
    dynamicSkillRequested,
    agentToolsActive,
  }
}
```

注意：`RequestedSkillsPayload.builtin` 的元素类型需与 `BUILTIN_SKILL_SLUGS` 匹配（既有代码用 `requestedBuiltinSkillSet.has(...)`，这里用 `includes`；若 builtin 元素为 slug 字符串则成立——实现时若类型不符改回 Set 写法）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/__tests__/agent-tool-config.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/chat/agent-tool-config.ts packages/backend/src/modules/chat/__tests__/agent-tool-config.test.ts
git commit -m "feat(vision-proxy): add vision proxy config builder and tool flags calculator"
```

---

### Task 6: 系统设置三键（schema + 服务读写 + 白名单 + env 回退）

**Files:**
- Modify: `packages/backend/src/api/settings.ts`（systemSettingSchema）
- Modify: `packages/backend/src/services/settings/settings-service.ts`（getSystemSettings 格式化 + 白名单 + updateSystemSettings）
- Modify: `.env.example`（根目录）
- Test: 复用既有 `settings-service` 相关测试（若无则跳过；schema 校验由 zValidator 隐式覆盖）

**Interfaces:**
- Produces: 系统设置键 `image_transcription_enabled`（boolean，默认 false）、`image_transcription_connection_id`（number|null）、`image_transcription_model_id`（string|null）；env 回退 `IMAGE_TRANSCRIPTION_ENABLED / IMAGE_TRANSCRIPTION_CONNECTION_ID / IMAGE_TRANSCRIPTION_MODEL_ID`

- [ ] **Step 1: api/settings.ts schema 加键**

在 `systemSettingSchema` 的 title_summary 区块后（L197 附近）加：

```ts
    // 图片转写代理设置
    image_transcription_enabled: z.boolean().optional(),
    image_transcription_connection_id: z.number().int().positive().nullable().optional(),
    image_transcription_model_id: z.string().min(1).nullable().optional(),
```

- [ ] **Step 2: settings-service.ts 格式化 + 白名单 + 更新**

在 `getSystemSettings` 的 formatted 对象（title_summary_* 三行，L431-435 附近）后加：

```ts
      image_transcription_enabled: this.parseBoolean(settingsObj.image_transcription_enabled, process.env.IMAGE_TRANSCRIPTION_ENABLED || 'false'),
      image_transcription_connection_id: settingsObj.image_transcription_connection_id ? Number(settingsObj.image_transcription_connection_id) : null,
      image_transcription_model_id: settingsObj.image_transcription_model_id || null,
```

非管理员白名单（L506-510 附近，title_summary_* 三行后）加：

```ts
        // 图片转写代理设置（所有用户可见，前端据此解锁加图）
        image_transcription_enabled: formatted.image_transcription_enabled,
        image_transcription_connection_id: formatted.image_transcription_connection_id,
        image_transcription_model_id: formatted.image_transcription_model_id,
```

`updateSystemSettings`（参考 title_summary_* 的 assignIfNumber / push 模式，L572-573、L653-654 附近）：

```ts
    assignIfNumber('image_transcription_connection_id', payload.image_transcription_connection_id)
    assignIfBoolean('image_transcription_enabled', payload.image_transcription_enabled)
```
并在 `{ key: ..., value: ... }` 批量数组中加（若该函数用数组 push 模式）：
```ts
      { key: 'image_transcription_model_id', value: payload.image_transcription_model_id },
```
实现时以文件内既有 `title_summary_*` 的处理方式为准（assignIfNumber/assignIfBoolean/数组三处）。

- [ ] **Step 3: .env.example 加回退变量**

在 title_summary 相关变量附近加：

```env
# 图片转写代理（vision 代理模型）
IMAGE_TRANSCRIPTION_ENABLED=false
IMAGE_TRANSCRIPTION_CONNECTION_ID=
IMAGE_TRANSCRIPTION_MODEL_ID=
```

- [ ] **Step 4: 运行既有测试确认无回归**

Run: `cd E:/codebase/aichat && pnpm --filter backend test -- --silent 2>&1 | tail -20`
Expected: 全部 PASS（settings 相关无失败）。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/api/settings.ts packages/backend/src/services/settings/settings-service.ts .env.example
git commit -m "feat(vision-proxy): add image transcription system settings"
```

---

### Task 7: ChatRequestBuilder.prepare 扩展（描述注入 + 历史回放）

**Files:**
- Modify: `packages/backend/src/modules/chat/services/chat-request-builder.ts`
- Test: `packages/backend/src/modules/chat/services/__tests__/chat-request-builder.test.ts`（新建）

**Interfaces:**
- Consumes: `ImageDescription`（Task 3）
- Produces（PrepareChatRequestParams 新增可选字段）：
```ts
  /** 主模型是否支持识图（未知视为 true，保持既有行为） */
  mainModelVision?: boolean
  /** 当前轮次图片转写描述前缀（自动转写注入） */
  visionTranscriptionPrefix?: string
  /** 历史用户消息 id → 图片描述（仅主模型无 vision 时注入） */
  historyImageDescriptions?: Map<number, ImageDescription[]> | null
```

- [ ] **Step 1: 写失败测试**

```ts
// packages/backend/src/modules/chat/services/__tests__/chat-request-builder.test.ts
import { ChatRequestBuilder } from '../chat-request-builder'

const prisma = {
  systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
  message: { findMany: jest.fn().mockResolvedValue([]) },
  modelCatalog: { findUnique: jest.fn().mockResolvedValue(null) },
} as any

const session = {
  id: 1,
  connectionId: 1,
  connection: { id: 1, baseUrl: 'https://api.example.com/v1', provider: 'openai', authType: 'bearer', headersJson: '', azureApiVersion: null, vendor: null, prefixId: null } as any,
  modelRawId: 'gpt-4o-mini',
  systemPrompt: null,
} as any

const payload = { contextEnabled: true } as any

const build = () => new ChatRequestBuilder({ prisma })

describe('ChatRequestBuilder.prepare vision proxy', () => {
  it('injects visionTranscriptionPrefix into current user message and strips images', async () => {
    const prepared = await build().prepare({
      session,
      payload,
      content: '看看这张图',
      images: [{ data: 'aGk=', mime: 'image/png' }],
      mode: 'stream',
      mainModelVision: false,
      visionTranscriptionPrefix: '图片里有一只猫',
      historyImageDescriptions: null,
    })
    const messages: any[] = prepared.baseRequestBody.messages
    const last = messages[messages.length - 1]
    expect(JSON.stringify(last.content)).toContain('图片里有一只猫')
    expect(JSON.stringify(last.content)).not.toContain('image_url')
    expect(JSON.stringify(last.content)).toContain('看看这张图')
  })

  it('keeps images for vision main model', async () => {
    const prepared = await build().prepare({
      session,
      payload,
      content: '看看这张图',
      images: [{ data: 'aGk=', mime: 'image/png' }],
      mode: 'stream',
      mainModelVision: true,
    })
    const messages: any[] = prepared.baseRequestBody.messages
    const last = messages[messages.length - 1]
    expect(JSON.stringify(last.content)).toContain('image_url')
    expect(JSON.stringify(last.content)).not.toContain('图片里有一只猫')
  })

  it('injects history descriptions into historical user messages', async () => {
    const historyImageDescriptions = new Map<number, any[]>([[100, [{ description: '历史上的图：一只狗', modelRawId: 'm' }]]])
    const prepared = await build().prepare({
      session,
      payload,
      content: '继续',
      mode: 'stream',
      mainModelVision: false,
      historyImageDescriptions,
      historySnapshot: {
        messages: [
          { id: 100, role: 'user', content: '看这张', createdAt: new Date(), messageGroupId: null },
        ],
        groups: [],
      },
    })
    const messages: any[] = prepared.baseRequestBody.messages
    expect(JSON.stringify(messages)).toContain('历史上的图：一只狗')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/services/__tests__/chat-request-builder.test.ts`
Expected: FAIL（字段不存在 / 注入未生效）。

- [ ] **Step 3: 实现**

`PrepareChatRequestParams` 加三个字段（见 Interfaces）。`prepare()` 内：

1. 方法开头取默认值：
```ts
    const mainModelVision = params.mainModelVision !== false
    const visionTranscriptionPrefix = params.visionTranscriptionPrefix || ''
```
2. `buildContextMessages` 调用（L205-216）加传参：
```ts
      mainModelVision,
      historyImageDescriptions: params.historyImageDescriptions ?? null,
```
3. `buildContextMessages` 签名加两个字段；在 ungroupedMessages 组装完成（historySnapshot 分支的 map 之后、以及 DB 查询分支之后）立即注入。实现最小公共注入函数并两处调用：
```ts
    const injectHistoryDescriptions = (
      messages: Array<{ id: number; content: string }>,
    ) => {
      if (!params.historyImageDescriptions) return
      for (const msg of messages) {
        const descs = params.historyImageDescriptions.get(msg.id)
        if (descs && descs.length > 0) {
          const text = descs.map((d) => d.description).join('\n')
          msg.content = `${msg.content}\n\n[图片转写描述]\n${text}`
        }
      }
    }
```
（在 snapshot 分支 map 得到 ungroupedMessages 后调用；DB 分支加载完 ungroupedMessages 后调用；grouped 消息（压缩摘要）不注入。）
4. `buildMessagesPayload` 调用（L222）改：
```ts
    const messagesPayload = this.buildMessagesPayload(
      contextMessages,
      params.content,
      mainModelVision ? (params.images ?? []) : [],
    )
```
5. cacheSafePrefix（L255 附近）改：
```ts
    const cacheSafePrefix =
      ragUserPrefix +
      (visionTranscriptionPrefix
        ? `[图片转写描述]\n${visionTranscriptionPrefix}\n\n`
        : '') +
      `[当前时间: ${dateString}]`
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/services/__tests__/chat-request-builder.test.ts
pnpm --filter backend exec jest src/modules/chat/__tests__/document-tools.test.ts
```
Expected: 新测试 PASS；既有测试无回归。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/chat/services/chat-request-builder.ts packages/backend/src/modules/chat/services/__tests__/chat-request-builder.test.ts
git commit -m "feat(vision-proxy): support description prefix and history injection in request builder"
```

---

### Task 8: chat-stream-use-case 接线（决策 + 自动转写 + 工具流注入）

**Files:**
- Modify: `packages/backend/src/modules/chat/use-cases/chat-stream-use-case.ts`
- Modify: `packages/backend/src/modules/chat/agent-web-search-response.ts`（AgentResponseParams 加字段 + builtins 传 visionProxy + createSkillRegistry 传 service）
- Modify: `packages/backend/src/modules/skills/skill-registry.ts`（CreateSkillRegistryParams + createToolHandlerRegistry 调用）
- Modify: `packages/backend/src/api/chat.ts`（ChatStreamRoutesDeps 组装处加 visionProxyService）
- Modify: `packages/backend/src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts`（补 mock）
- Test: `packages/backend/src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts`（既有文件，新增用例）

**Interfaces:**
- Consumes: `VisionProxyConfig / isVisionProxyReady / parseStoredImageDescriptions / loadHistoryImageDescriptions / VisionProxyService / VisionProxyServiceError`（Task 3）、`buildAgentVisionProxyConfig / computeAgentToolFlags`（Task 5）、`resolveModelCapabilitiesForSession`（Task 2）
- Produces: `ChatStreamRoutesDeps.visionProxyService: VisionProxyService`；`AgentResponseParams` 新增 `visionProxyConfig?: VisionProxyConfig | null`、`visionProxyService?: VisionProxyService`；`toolFlags.visionProxy?: boolean`；`CreateSkillRegistryParams.visionProxyService?: VisionProxyService`

- [ ] **Step 1: skill-registry.ts 透传 service**

`CreateSkillRegistryParams` 加 `visionProxyService?: VisionProxyService`（import type）；`createSkillRegistry` 内调用改为：

```ts
  const registry = createToolHandlerRegistry(params.builtins, { visionProxyService: params.visionProxyService })
```

- [ ] **Step 2: agent-web-search-response.ts 接线**

- `AgentResponseParams` 加：
```ts
  visionProxyConfig?: VisionProxyConfig | null
  visionProxyService?: VisionProxyService
```
（import type：`VisionProxyConfig`/`VisionProxyService` from './services/vision-proxy-service'；`AgentToolFlags` 的 toolFlags 类型加 `visionProxy?: boolean`——先定位 toolFlags 的类型定义处。）
- `createSkillRegistry` 调用（L637 附近）的 `builtins` 对象加：
```ts
          visionProxy: toolFlags.visionProxy && params.visionProxyConfig ? params.visionProxyConfig : null,
```
- `createSkillRegistry({ ... })` 调用加 `visionProxyService: params.visionProxyService`。

- [ ] **Step 3: use-case 接线（核心）**

3.1 顶部 import 增加：

```ts
import { resolveModelCapabilitiesForSession } from '../../../utils/model-capabilities'
import {
  VisionProxyServiceError,
  isVisionProxyReady,
  loadHistoryImageDescriptions,
  parseStoredImageDescriptions,
  type VisionProxyService,
} from '../services/vision-proxy-service'
import { buildAgentVisionProxyConfig, computeAgentToolFlags } from '../agent-tool-config'
```

3.2 `ChatStreamRoutesDeps` 加 `visionProxyService: VisionProxyService`。

3.3 **将配置构建提前到 prepare() 之前**（现 L466-480）：把这四行 + agentMaxToolIterations + webSearchSkillOverride 从 prepare 之后移到 prepare 调用（L424）之前，`sysMap` 改用 `turnContext.systemSettings`：

```ts
      const agentWebSearchConfig = buildAgentWebSearchConfig(turnContext.systemSettings)
      const pythonToolConfig = buildAgentPythonToolConfig(turnContext.systemSettings)
      const urlReaderConfig = buildAgentUrlReaderConfig(turnContext.systemSettings)
      const workspaceToolConfig = buildAgentWorkspaceToolConfig(turnContext.systemSettings)
      const agentMaxToolIterations = resolveMaxToolIterations(turnContext.systemSettings)
      const webSearchSkillOverride = requestedSkills.overrides?.[BUILTIN_SKILL_SLUGS.WEB_SEARCH] || {}
      Object.assign(
        agentWebSearchConfig,
        applyWebSearchSkillOverrides(
          agentWebSearchConfig,
          webSearchSkillOverride,
          { sanitizeScope },
        ),
      )
```
（删除 prepare 之后 L466-480 的重复定义。）

3.4 prepare() 调用（L424-436）之前插入图片转写决策：

```ts
      // ===== 图片转写代理（Vision Transcription Proxy）=====
      // 主模型无 vision 且有图时：工具流 → 注入视觉分析工具由主模型自主调用；
      // 标准流（无工具）→ 后端自动转写，描述注入用户消息前缀并持久化（转写一次）
      const visionProxyConfig = buildAgentVisionProxyConfig(turnContext.systemSettings)
      const mainModelCapabilities = await resolveModelCapabilitiesForSession(prisma, session)
      const mainModelVision = mainModelCapabilities.vision !== false
      const hasImages = Array.isArray(images) && images.length > 0
      const visionProxyRequested = isVisionProxyReady(visionProxyConfig) && hasImages && !mainModelVision
      const preAgentToolFlags = visionProxyRequested
        ? computeAgentToolFlags({
            sysMap: turnContext.systemSettings,
            requestedSkills,
            hasKnowledgeBases,
            webSearchConfig: agentWebSearchConfig,
            pythonToolConfig,
            workspaceToolConfig,
            urlReaderConfig,
          })
        : null
      const visionProxyToolFlow = visionProxyRequested && Boolean(preAgentToolFlags?.agentToolsActive)
      const visionProxyAutoTranscribe = visionProxyRequested && !visionProxyToolFlow

      let visionTranscriptionPrefix = ''
      let payloadImages = images
      let historyImageDescriptions: Map<number, { description: string; modelRawId: string }[]> | null = null
      if (visionProxyRequested) {
        historyImageDescriptions = await loadHistoryImageDescriptions(prisma, sessionId, historyUpperBound)
      }
      if (visionProxyAutoTranscribe) {
        const stored = userMessageRecord ? parseStoredImageDescriptions((userMessageRecord as any).imageDescriptionsJson) : null
        if (stored && stored.length > 0) {
          // 已转写过（消息复用/重发）：直接复用，不重复调用视觉模型
          visionTranscriptionPrefix = stored[0].description
          payloadImages = []
        } else {
          try {
            const { description, modelRawId } = await visionProxyService.transcribeImages(
              images,
              content,
              visionProxyConfig,
            )
            visionTranscriptionPrefix = description
            payloadImages = []
            if (userMessageRecord) {
              await prisma.message.update({
                where: { id: userMessageRecord.id },
                data: {
                  imageDescriptionsJson: JSON.stringify([{ description, modelRawId }]),
                },
              })
            }
          } catch (error) {
            if (error instanceof VisionProxyServiceError) {
              return c.json<ApiResponse>({
                success: false,
                error: `图片转写失败：${error.message}`,
              }, error.statusCode as any)
            }
            throw error
          }
        }
      } else if (visionProxyToolFlow) {
        // 工具流：图片不发给主模型，由 analyze_visual_media 工具按需读取附件
        payloadImages = []
      }
```

3.5 prepare() 调用加参数：

```ts
        images: payloadImages,
        ...
        mainModelVision,
        visionTranscriptionPrefix: visionTranscriptionPrefix || undefined,
        historyImageDescriptions,
```

3.6 **工具标志块改造**（现 L547-606）：把整个标志计算替换为：

```ts
      const agentToolFlags = computeAgentToolFlags({
        sysMap,
        requestedSkills,
        hasKnowledgeBases,
        webSearchConfig: agentWebSearchConfig,
        pythonToolConfig,
        workspaceToolConfig,
        urlReaderConfig,
      })
```
后续引用改为 `agentToolFlags.agentWebSearchActive`、`agentToolFlags.pythonToolActive`、`agentToolFlags.workspaceToolsActive`、`agentToolFlags.urlReaderActive`、`agentToolFlags.documentToolsActive`、`agentToolFlags.knowledgeBaseToolsActive`、`agentToolFlags.dynamicSkillRequested`、`agentToolFlags.agentToolsActive`（dynamicSkillDisabledMessage 判断保持等价）。

3.7 agent 分支调用（L713-760）加参数：

```ts
          visionProxyConfig: visionProxyToolFlow ? visionProxyConfig : null,
          visionProxyService,
```
toolFlags 对象加 `visionProxy: visionProxyToolFlow`。

- [ ] **Step 4: 补 mock 与测试**

`chat-stream-use-case.test.ts` 顶部补：

```ts
// Mock vision-proxy-service
jest.mock('../../services/vision-proxy-service', () => ({
  __esModule: true,
  VisionProxyServiceError: class VisionProxyServiceError extends Error {
    statusCode = 500
  },
  isVisionProxyReady: jest.fn().mockReturnValue(false),
  loadHistoryImageDescriptions: jest.fn().mockResolvedValue(new Map()),
  parseStoredImageDescriptions: jest.fn().mockReturnValue(null),
  loadVisionProxyConfig: jest.fn(),
}))

// Mock model-capabilities
jest.mock('../../../../utils/model-capabilities', () => ({
  __esModule: true,
  resolveModelCapabilitiesForSession: jest.fn().mockResolvedValue({ vision: true }),
}))
```
（注意：`buildAgentVisionProxyConfig` 由 `agent-tool-config.ts` 导出——若该模块已被 mock，则补 `buildAgentVisionProxyConfig`/`computeAgentToolFlags` 到对应 mock；若未 mock，直接使用真实实现。`visionProxyService` 需要在构建 deps 时以 `{ transcribeImages: jest.fn() }` 传入。）

新增用例（isVisionProxyReady mock 改 true、resolveModelCapabilitiesForSession 返回 `{ vision: false }`、transcribeImages mock 返回 `{ description: '图里有一只猫', modelRawId: 'm' }`）：

```ts
  it('auto-transcribes images for non-vision main model in standard flow', async () => {
    ;(isVisionProxyReady as jest.Mock).mockReturnValue(true)
    ;(resolveModelCapabilitiesForSession as jest.Mock).mockResolvedValue({ vision: false })
    ;(visionProxyService.transcribeImages as jest.Mock).mockResolvedValue({ description: '图里有一只猫', modelRawId: 'm' })
    // ...构造 handler + 请求，断言 chatRequestBuilder.prepare 收到的 images 为空、含 visionTranscriptionPrefix
  })
```
（实现时以既有用例的 handler 构造方式为准：`createChatStreamHandler` + `requestValidation.ensureSession` mock 等。）

- [ ] **Step 5: api/chat.ts 组装处加依赖**

找到 `ChatStreamRoutesDeps` 的组装位置（`index.ts` 或 `api/chat.ts` 的上游），加：

```ts
      visionProxyService: new VisionProxyService({ secretVault }),
```
（`secretVault` 从容器/上游已有实例获取；若组装处拿不到，则在 `app-container.ts` 新增 `visionProxyService` 成员并在 ChatApiDeps 传递。）

- [ ] **Step 6: 运行测试**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts
pnpm --filter backend exec jest src/modules/chat/__tests__/agent-tool-config.test.ts
pnpm --filter backend exec jest src/modules/chat/services/__tests__/chat-request-builder.test.ts
pnpm --filter backend exec jest src/modules/chat/tool-handlers/__tests__/vision-proxy-handler.test.ts
pnpm --filter backend exec jest src/modules/chat/services/__tests__/vision-proxy-service.test.ts
pnpm --filter backend exec jest src/utils/__tests__/model-capabilities.test.ts
pnpm --filter backend exec jest src/modules/chat/__tests__/document-tools.test.ts
pnpm --filter backend test -- --silent 2>&1 | tail -30
```
Expected: 全部 PASS（若后端全量测试原有既有失败，记录并只保证本计划涉及文件无回归）。

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/chat/use-cases/chat-stream-use-case.ts packages/backend/src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts packages/backend/src/modules/chat/agent-web-search-response.ts packages/backend/src/modules/skills/skill-registry.ts packages/backend/src/api/chat.ts packages/backend/src/index.ts packages/backend/src/container/app-container.ts
git commit -m "feat(vision-proxy): wire transcription decision into chat stream use case"
```

---

### Task 9: message-query-service 暴露 imageDescriptions

**Files:**
- Modify: `packages/backend/src/modules/chat/services/message-query-service.ts`
- Test: `packages/backend/src/modules/chat/services/message-query-service.test.ts`（既有，追加用例）

**Interfaces:**
- Produces: `NormalizedMessage.imageDescriptions?: Array<{ description: string; modelRawId: string }> | null`

- [ ] **Step 1: 写失败测试（追加到既有测试文件）**

```ts
  it('normalizes imageDescriptionsJson into imageDescriptions', async () => {
    // 使用既有测试的构造方式（mock prisma.message.findMany 返回含 imageDescriptionsJson 的记录）
    // 断言 normalizeMessage 输出含 imageDescriptions: [{ description: '图', modelRawId: 'm' }]
  })
```
（实现时复用该文件既有 fixture 结构。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/services/message-query-service.test.ts`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**

- `messageSelectFields`（L39 附近）加：`imageDescriptionsJson: true,`
- `RawMessage` 类型加 `imageDescriptionsJson?: string | null`
- `normalizeMessage` 解构加 `imageDescriptionsJson`，返回对象加：

```ts
      imageDescriptions: (() => {
        if (!imageDescriptionsJson) return null
        try {
          const parsed = JSON.parse(imageDescriptionsJson)
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
        } catch {
          return null
        }
      })(),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd E:/codebase/aichat && pnpm --filter backend exec jest src/modules/chat/services/message-query-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/chat/services/message-query-service.ts packages/backend/src/modules/chat/services/message-query-service.test.ts
git commit -m "feat(vision-proxy): expose imageDescriptions in message API"
```

---

### Task 10: shared settings 契约 + 前端 settings 类型/映射

**Files:**
- Modify: `packages/shared/src/settings-contract.ts`
- Modify: `packages/frontend/src/types/index.ts`（SystemSettings 类型，titleSummary* 附近）
- Modify: `packages/frontend/src/features/settings/api.ts`（camel 映射 + patch 序列化）

**Interfaces:**
- Produces: 前端 `systemSettings.imageTranscriptionEnabled: boolean`、`imageTranscriptionConnectionId: number | null`、`imageTranscriptionModelId: string | null`；patch 可写回

- [ ] **Step 1: shared 契约**

`packages/shared/src/settings-contract.ts`（titleSummary* 映射附近，L72-76）加：

```ts
  imageTranscriptionConnectionId: 'image_transcription_connection_id',
  imageTranscriptionEnabled: 'image_transcription_enabled',
  imageTranscriptionModelId: 'image_transcription_model_id',
```

- [ ] **Step 2: 前端类型**

`packages/frontend/src/types/index.ts` SystemSettings（titleSummary* 三字段附近）加：

```ts
  imageTranscriptionEnabled?: boolean
  imageTranscriptionConnectionId?: number | null
  imageTranscriptionModelId?: string | null
```

- [ ] **Step 3: 前端 api 映射**

`packages/frontend/src/features/settings/api.ts`：
- camel 映射（L364-381 附近）加三行 `image_transcription_enabled → imageTranscriptionEnabled` 等（照 titleSummary 三行模式）
- patch 序列化（L652-661 附近）加 `imageTranscriptionEnabled` / `imageTranscriptionConnectionId` / `imageTranscriptionModelId`（照 titleSummary 模式）

- [ ] **Step 4: 验证**

Run: `cd E:/codebase/aichat && pnpm --filter frontend exec tsc --noEmit 2>&1 | head -20`
Expected: 无新增类型错误。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/settings-contract.ts packages/frontend/src/types/index.ts packages/frontend/src/features/settings/api.ts
git commit -m "feat(vision-proxy): add image transcription settings contract to frontend"
```

---

### Task 11: 前端 composer 门禁放宽 + 提示条

**Files:**
- Modify: `packages/frontend/src/features/chat/composer/use-image-attachments.ts`
- Modify: `packages/frontend/src/hooks/use-chat-composer.ts`
- Modify: `packages/frontend/src/components/chat/composer-attachment-list.tsx`
- Modify: `packages/frontend/src/components/chat/desktop-composer.tsx`、`packages/frontend/src/components/chat/mobile-composer.tsx`
- Test: `packages/frontend/src/features/chat/composer/__tests__/use-image-attachments.test.tsx`（既有，追加用例）、`packages/frontend/src/components/chat/__tests__/composer-attachment-list.test.tsx`（既有，追加用例）

**Interfaces:**
- Produces: `useImageAttachments({ isVisionEnabled, visionProxyEnabled?, limits, toast })`（visionProxyEnabled 默认 false）；`ComposerAttachmentList` 新增可选 prop `visionProxyHint?: string | null`

- [ ] **Step 1: 写失败测试（追加）**

`use-image-attachments.test.tsx` 追加：

```tsx
  it('allows adding images when vision disabled but vision proxy enabled', async () => {
    // renderHook 传 { isVisionEnabled: false, visionProxyEnabled: true, limits, toast }
    // act 调用 onFilesSelected 传入合法图片，断言 selectedImages 长度 > 0、无 destructive toast
  })
  it('clears images only when both vision and proxy disabled', async () => {
    // 先选图（vision=true），rerender 为 { isVisionEnabled: false, visionProxyEnabled: true }
    // 断言 selectedImages 不被清空；再 rerender visionProxyEnabled=false 断言被清空
  })
```

`composer-attachment-list.test.tsx` 追加：

```tsx
  it('renders vision proxy hint when images present', async () => {
    // render ComposerAttachmentList images=[...] visionProxyHint="qwen-vl-max"
    // 断言文本包含「图片将由 qwen-vl-max 转写」
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter frontend exec vitest run src/features/chat/composer/__tests__/use-image-attachments.test.tsx src/components/chat/__tests__/composer-attachment-list.test.tsx`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现 use-image-attachments**

`useImageAttachments` 签名加 `visionProxyEnabled = false`；内部 `const canAttachImages = isVisionEnabled || visionProxyEnabled`；把三处 `isVisionEnabled` 判定（useEffect 清空、pickImages、handlePaste）替换为 `canAttachImages`；`visionDisabledMessage` 文案在 `!isVisionEnabled && visionProxyEnabled` 时改为提示性文案（不阻止）。

- [ ] **Step 4: 实现提示条**

`ComposerAttachmentList` 加 prop `visionProxyHint?: string | null`；在缩略图列表上方渲染：

```tsx
      {visionProxyHint && images.length > 0 && (
        <p className="w-full text-xs text-amber-600">
          ⚠ 当前模型不支持识图，图片将由 {visionProxyHint} 转写
        </p>
      )}
```

`desktop-composer.tsx` / `mobile-composer.tsx` 中渲染 `ComposerAttachmentList` 处传：

```tsx
          visionProxyHint={!isVisionEnabled && visionProxyEnabled ? visionProxyModelId ?? null : null}
```

- [ ] **Step 5: use-chat-composer 接线**

`use-chat-composer.ts`：从 `systemSettings`（该 hook 已持有）取：

```ts
  const visionProxyEnabled = systemSettings?.imageTranscriptionEnabled === true
  const visionProxyModelId = systemSettings?.imageTranscriptionModelId ?? null
```
`useImageAttachments` 调用加 `visionProxyEnabled`；把 `visionProxyEnabled` / `visionProxyModelId` 透出给 composer 组件（若该 hook 已透出 feature flags 对象则并入）。

- [ ] **Step 6: 运行测试确认通过**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter frontend exec vitest run src/features/chat/composer/__tests__/use-image-attachments.test.tsx src/components/chat/__tests__/composer-attachment-list.test.tsx
pnpm --filter frontend exec tsc --noEmit 2>&1 | head -20
```
Expected: PASS，无类型错误。

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/features/chat/composer/use-image-attachments.ts packages/frontend/src/hooks/use-chat-composer.ts packages/frontend/src/components/chat/composer-attachment-list.tsx packages/frontend/src/components/chat/desktop-composer.tsx packages/frontend/src/components/chat/mobile-composer.tsx packages/frontend/src/features/chat/composer/__tests__/use-image-attachments.test.tsx packages/frontend/src/components/chat/__tests__/composer-attachment-list.test.tsx
git commit -m "feat(vision-proxy): relax composer image gate and show transcription hint"
```

---

### Task 12: 前端消息小字标识（图片描述由 xx 转写）

**Files:**
- Modify: `packages/frontend/src/types/index.ts`（Message / MessageMeta 加 imageDescriptions）
- Modify: `packages/frontend/src/features/chat/store/utils/index.ts`（`createMeta` 透传）
- Modify: `packages/frontend/src/features/chat/store/slices/stream-slice.ts`（乐观消息加字段）
- Modify: `packages/frontend/src/components/message-bubble/message-header.tsx`（用户分支渲染小字）
- Modify: `packages/frontend/src/components/message-bubble/index.tsx`（把 meta.imageDescriptions 传给 MessageHeader）
- Test: `packages/frontend/src/components/message-bubble/__tests__/message-header.test.tsx`（新建，若目录不存在则创建）

**Interfaces:**
- Produces: `Message.imageDescriptions?: Array<{ description: string; modelRawId: string }> | null`；`MessageMeta.imageDescriptions?: Array<{ description: string; modelRawId: string }> | null`

- [ ] **Step 1: 写失败测试**

```tsx
// packages/frontend/src/components/message-bubble/__tests__/message-header.test.tsx
import { render, screen } from '@testing-library/react'
import { MessageHeader } from '../message-header'

describe('MessageHeader user branch image description note', () => {
  it('renders transcription note when imageDescriptions present', () => {
    render(
      <MessageHeader
        isUser
        timestamp="2026-08-04"
        imageDescriptionNote="图片描述由 qwen-vl-max 转写"
      />,
    )
    expect(screen.getByText(/图片描述由 qwen-vl-max 转写/)).toBeInTheDocument()
  })

  it('renders nothing when note absent', () => {
    render(<MessageHeader isUser timestamp="2026-08-04" />)
    expect(screen.queryByText(/图片描述由/)).not.toBeInTheDocument()
  })
})
```
（若 MessageHeader 的 props 类型缺该字段，先按测试意图补 `imageDescriptionNote?: string | null`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter frontend exec vitest run src/components/message-bubble/__tests__/message-header.test.tsx`
Expected: FAIL（props 不存在）。

- [ ] **Step 3: 实现**

- `message-header.tsx`：`MessageHeaderProps` 加 `imageDescriptionNote?: string | null`；用户分支（L45-55 小字行内）加：

```tsx
        {imageDescriptionNote && (
          <span title="图片由转写模型识别后供当前模型理解">{imageDescriptionNote}</span>
        )}
```
- `message-bubble/index.tsx` 用户分支 MessageHeader 调用处传：

```tsx
              imageDescriptionNote={
                meta.imageDescriptions?.length
                  ? `图片描述由 ${meta.imageDescriptions[0].modelRawId} 转写`
                  : null
              }
```
- `types/index.ts`：`Message`（L173）与 `MessageMeta`（L209）各加 `imageDescriptions?: Array<{ description: string; modelRawId: string }> | null`
- `features/chat/store/utils/index.ts` `createMeta`（L155）：在返回的 meta 中带 `imageDescriptions: message.imageDescriptions ?? null`
- `stream-slice.ts` 乐观用户消息（L308-323）：加 `imageDescriptions: null`

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter frontend exec vitest run src/components/message-bubble/__tests__/message-header.test.tsx
pnpm --filter frontend exec tsc --noEmit 2>&1 | head -20
```
Expected: PASS，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/types/index.ts packages/frontend/src/features/chat/store/utils/index.ts packages/frontend/src/features/chat/store/slices/stream-slice.ts packages/frontend/src/components/message-bubble/message-header.tsx packages/frontend/src/components/message-bubble/index.tsx packages/frontend/src/components/message-bubble/__tests__/message-header.test.tsx
git commit -m "feat(vision-proxy): show transcription source note under user message"
```

---

### Task 13: 系统设置页「图片转写代理」Feature Card

**Files:**
- Create: `packages/frontend/src/components/settings/pages/model-connections/ImageTranscriptionCard.tsx`（或与既有 pages 目录风格一致）
- Modify: `packages/frontend/src/components/settings/system-settings-registry.tsx`（tree 加叶子页 + 页面 dynamic 注册 + systemSettingsCards）
- Test: `packages/frontend/src/components/settings/pages/model-connections/__tests__/ImageTranscriptionCard.test.tsx`（新建）

**Interfaces:**
- Consumes: `useSystemSettings`（settings-store）、`useSystemConnections`（system-connections）、`getAggregatedModels`（features/system/api）、`ModelSelector` 或原生 Select（按 title-summary-card 模式）
- Produces: 页面注册键 `model-connections:image-transcription`（cardKey `image-transcription:vision-proxy` 或按既有命名，见 Step 3 定位）

- [ ] **Step 1: 写失败测试**

```tsx
// packages/frontend/src/components/settings/pages/model-connections/__tests__/ImageTranscriptionCard.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageTranscriptionCard } from '../ImageTranscriptionCard'

describe('ImageTranscriptionCard', () => {
  it('renders switch bound to imageTranscriptionEnabled', () => {
    const update = vi.fn()
    render(
      <ImageTranscriptionCard
        settings={{ imageTranscriptionEnabled: false } as any}
        update={update}
      />,
    )
    expect(screen.getByText(/图片转写代理/)).toBeInTheDocument()
  })

  it('calls update with enabled true when toggled', async () => {
    const update = vi.fn()
    render(
      <ImageTranscriptionCard
        settings={{ imageTranscriptionEnabled: false } as any}
        update={update}
      />,
    )
    await userEvent.click(screen.getByRole('switch'))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ imageTranscriptionEnabled: true }))
  })
})
```
（mock 依赖：`useSystemConnections`、`getAggregatedModels` 用 `vi.mock` 返回空/假数据。）

- [ ] **Step 2: 运行测试确认失败**

Run: `cd E:/codebase/aichat && pnpm --filter frontend exec vitest run src/components/settings/pages/model-connections/__tests__/ImageTranscriptionCard.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现卡片**

仿照 `title-summary-card.tsx`（L67-145）的 FeatureCard 结构：

```tsx
'use client'

import { Image as ImageIcon } from 'lucide-react'
import { FeatureCard } from '../../components/feature-card'
import { SettingRow } from '../../components/setting-row'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSystemConnections } from '../../system-connections/use-system-connections'
import { getAggregatedModels } from '@/features/system/api'
import { useEffect, useMemo, useState } from 'react'

export interface ImageTranscriptionCardProps {
  settings: Record<string, unknown>
  update: (patch: Record<string, unknown>) => void
}

export function ImageTranscriptionCard({ settings, update }: ImageTranscriptionCardProps) {
  const enabled = settings.imageTranscriptionEnabled === true
  const connectionId = settings.imageTranscriptionConnectionId as number | null | undefined
  const modelId = settings.imageTranscriptionModelId as string | null | undefined
  const { groups } = useSystemConnections()
  const connections = useMemo(
    () => (groups ?? []).flatMap((g) => g.connections ?? []),
    [groups],
  )
  const [models, setModels] = useState<Array<{ id: string; rawId: string; name: string; connectionId: number }>>([])

  useEffect(() => {
    let alive = true
    getAggregatedModels()
      .then((items) => {
        if (!alive) return
        setModels(
          (items ?? []).filter(
            (m) => m.capabilities?.vision === true && m.modelType !== 'embedding',
          ),
        )
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const candidateModels = useMemo(
    () => models.filter((m) => m.connectionId === Number(connectionId)),
    [models, connectionId],
  )

  const toggle = (next: boolean) => update({ imageTranscriptionEnabled: next })
  const selectConnection = (value: string) => update({ imageTranscriptionConnectionId: Number(value), imageTranscriptionModelId: null })
  const selectModel = (value: string) => update({ imageTranscriptionModelId: value })

  return (
    <FeatureCard
      icon={ImageIcon}
      title="图片转写代理"
      description="主模型不支持识图时，自动将图片交给指定的识图模型转写为文字描述，再回传给主模型。"
      cardKey="model-connections:image-transcription"
      enabled={enabled}
      onEnabledChange={toggle}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">开关默认关闭；需选择转写模型后生效。</span>
        </div>
      }
    >
      <SettingRow label="转写连接" description="承载识图模型的系统连接">
        <Select value={connectionId ? String(connectionId) : ''} onValueChange={selectConnection}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="选择连接" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((conn) => (
              <SelectItem key={conn.id} value={String(conn.id)}>
                {conn.name ?? `连接 ${conn.id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label="转写模型" description="仅列出该连接下具备识图能力的模型">
        <Select value={modelId ?? ''} onValueChange={selectModel}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder={connectionId ? '选择模型' : '请先选择连接'} />
          </SelectTrigger>
          <SelectContent>
            {candidateModels.map((m) => (
              <SelectItem key={m.id} value={m.rawId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </FeatureCard>
  )
}
```
（以实际组件库导出为准：Switch/Select/SettingRow 的导入路径与 title-summary-card.tsx 一致；useSystemConnections 返回结构以实际为准，grep `useSystemConnections` 的返回类型后修正 `groups`/`connections` 字段名。）

- [ ] **Step 4: registry 注册**

`system-settings-registry.tsx`：
- tree「模型与连接」分组（L126-139）children 加叶子节点：`{ key: 'image-transcription', label: '图片转写', ... }`（照 connections/models 节点结构）
- 页面 dynamic 注册：`const ImageTranscriptionPage = dynamic(() => import('./pages/model-connections/ImageTranscriptionCard'))`（照 ModelsPage 的注册方式；若页面需独立 Page 包裹则照 SystemConnections.tsx 结构）
- `systemSettingsCards` 加 `'model-connections:image-transcription': { title: '图片转写代理', ... }`（照 L229 既有条目格式）

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
cd E:/codebase/aichat && pnpm --filter frontend exec vitest run src/components/settings/pages/model-connections/__tests__/ImageTranscriptionCard.test.tsx
pnpm --filter frontend exec tsc --noEmit 2>&1 | head -20
```
Expected: PASS，无类型错误。

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/settings/pages/model-connections/ packages/frontend/src/components/settings/system-settings-registry.tsx
git commit -m "feat(vision-proxy): add image transcription settings card"
```

---

### Task 14: 文档更新（CONTEXT.md + CHANGELOG.md）

**Files:**
- Modify: `CONTEXT.md`（设置 → 新词条；新增「图片转写」小节）
- Modify: `CHANGELOG.md`（unreleased 段）

- [ ] **Step 1: CONTEXT.md 新增术语**

在「设置」小节（Settings Center 附近）追加：

```markdown
- **Vision Transcription Proxy（图片转写代理）**：主模型不支持识图（vision）时，将用户消息中的图片自动交给管理员指定的识图模型转写为文字描述的系统能力；由系统设置「图片转写代理」开关（默认关闭）+ 连接 + 模型配置，作用于所有用户
- **Image Transcription（图片转写）**：指定识图模型将图片附件转换为文字描述的过程；结果持久化到用户消息的 imageDescriptions 字段，后续轮次直接复用（转写一次）
- **Visual Analysis Tool（视觉分析工具）**：内置工具 `analyze_visual_media`，仅在主聊天流处于工具流且主模型无 vision 时注入；主模型可自主多次调用，描述以工具结果回传并随工具事件持久化
```

- [ ] **Step 2: CHANGELOG.md 记录**

在 unreleased 段（若无则新建 `## [Unreleased]`）追加：

```markdown
### Added
- 图片转写代理：主模型不支持识图时自动将图片转交给管理员指定的识图模型（工具流由主模型自主调用 `analyze_visual_media`，标准流自动转写注入描述），转写结果持久化复用；系统设置新增「图片转写代理」卡片（默认关闭）
```

- [ ] **Step 3: 验证 + Commit**

Run: `cd E:/codebase/aichat && git diff --stat`
Expected: 仅 CONTEXT.md / CHANGELOG.md 变更。

```bash
git add CONTEXT.md CHANGELOG.md
git commit -m "docs(vision-proxy): update context glossary and changelog"
```

---

### Task 15: 端到端手工验证清单（非代码任务）

浏览器实测（docker 或本地 dev 起服务）：
1. 管理员在「系统设置 → 模型与连接 → 图片转写」开启开关、选择连接与 vision 模型（如 qwen-vl/gemini-flash）。
2. 新建会话选无 vision 模型（如 gpt-3.5-turbo / deepseek-chat）：上传图片 → 输入框上方出现「图片将由 xx 转写」提示条 → 发送 → 回复包含图片内容相关描述；用户消息下出现「图片描述由 xx 转写」小字。
3. 追问图片细节（如"文字内容是什么"）→ 主模型仍能基于已持久化描述回答（不重复转写，观察后端日志无第二次 vision 调用）。
4. 选 vision 模型（如 gpt-4o）同图发送 → 行为与改造前一致（图片直接发主模型，无转写提示）。
5. 工具流验证：开 web search 技能 + 无 vision 模型 + 发图 → 聊天流出现「视觉分析」工具卡片；主模型自主调用 `analyze_visual_media`。
6. 关闭系统开关后：无 vision 模型恢复禁止加图（toast「已清空图片」）。
7. 转写失败场景（临时改错 model id）：标准流返回明确报错「图片转写失败：…」；工具流错误作为工具结果由主模型解释。

验证通过后，在 PR 描述/合并说明中附上本清单执行结果。

---

## Self-Review

**1. Spec coverage（对照已确认需求）**
- 混合式：Task 8（标准流自动转写 + 工具流注入）、Task 4（工具 handler）✓
- 系统级配置 + 开关默认关：Task 6 + Task 13 ✓
- 转写一次并持久化：Task 8（`imageDescriptionsJson` 持久化 + 复用）、Task 7（历史注入）、Task 3（loadHistoryImageDescriptions）✓
- 兜底式固定 prompt 附用户问题：Task 3 `TRANSCRIPTION_SYSTEM_PROMPT` + userText ✓
- UI 透明：Task 11（提示条）、Task 12（小字）、Task 13（设置卡）✓
- 失败降级：Task 8（标准流 502 报错中止）、Task 4（工具流错误回传）✓
- 范围仅图片：全计划仅处理 `images` 数组 ✓
- 历史回放安全网：Task 7（无 vision 时历史注入描述；历史消息本就不含图，无 400 风险）✓

**2. Placeholder scan**
- 所有任务含具体代码/命令；Task 8 Step 4 的用例骨架依赖既有测试 fixture（文件内结构），已注明「以既有用例构造方式为准」；Task 13 依赖组件库实际导出，已注明 grep 校验点。无 TBD/TODO。

**3. Type consistency**
- `VisionProxyConfig`/`ImageDescription`/`VisionProxyServiceError`/`loadVisionProxyConfig`/`isVisionProxyReady`/`parseStoredImageDescriptions`/`loadHistoryImageDescriptions`/`transcribeImages` 在 Task 3 定义，Task 4/5/8/10 引用一致。
- `resolveModelCapabilitiesForSession`（Task 2）→ Task 8 使用。
- `computeAgentToolFlags`（Task 5）→ Task 8 使用。
- `imageDescriptionsJson`（Task 1 列名）贯穿 Task 3/7/8/9；前端 `imageDescriptions`（Task 9 后端 DTO → Task 12 前端类型）一致。
- `visionProxy`（toolFlags / builtins / ToolHandlerFactoryParams）在 Task 4/5/8 间命名一致。
