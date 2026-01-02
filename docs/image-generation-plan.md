# 生图模型支持实现规划

## 概述

为 AI Chat 项目添加生图模型支持。

## 当前状态

- ✅ 能力标识系统已预留 `image_generation` 标记
- ✅ 启发式检测可识别生图模型（dall、flux、sdxl、imagen 等）
- ❌ 无生图 API 调用逻辑
- ❌ 流式响应不支持图片数据
- ❌ 前端无法渲染模型生成的图片

---

## 核心发现：只需要两种 API

### API 类型 1: OpenAI 风格 `/images/generations`

适用于：**DALL-E、Nano-GPT、Google Imagen (兼容端点)** 等所有 OpenAI 兼容服务

**端点**: `POST /v1/images/generations`

**请求参数**:
```json
{
  "model": "dall-e-3",           // 或 hidream, imagen-3.0-generate-002 等
  "prompt": "A white siamese cat",
  "size": "1024x1024",
  "n": 1,
  "response_format": "b64_json"  // 或 "url"
}
```

**响应格式**:
```json
{
  "created": 1589478378,
  "data": [
    {
      "b64_json": "iVBORw0KGgo...",
      "url": "https://...",
      "revised_prompt": "..."
    }
  ]
}
```

**支持的模型/服务**:
| 服务 | 模型示例 |
|------|----------|
| OpenAI | `dall-e-3`, `dall-e-2`, `gpt-image-1.5` |
| Nano-GPT | `hidream`, `flux-kontext`, `recraft-v3` |
| Google Imagen | `imagen-4.0-generate-001`, `imagen-3.0-generate-002` |

---

### API 类型 2: Gemini `GenerateContent` 返回图片

适用于：**Gemini Flash Image (Nano Banana 风格)**

**端点**: `POST /v1beta/models/{model}:generateContent`

**请求参数**:
```json
{
  "contents": [
    {
      "parts": [
        { "text": "A photorealistic portrait of..." }
      ],
      "role": "user"
    }
  ]
}
```

**响应格式** (图片在 parts 中):
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "iVBORw0KGgo..."
            }
          }
        ]
      }
    }
  ]
}
```

**支持的模型**:
| 模型 | 说明 |
|------|------|
| `gemini-2.5-flash-image` | 支持 Text-to-Image 和 Image-to-Image |

**Image-to-Image 请求** (风格转换):
```json
{
  "contents": [
    {
      "parts": [
        {
          "inlineData": {
            "mimeType": "image/png",
            "data": "{input_image_base64}"
          }
        },
        { "text": "Transform into Van Gogh style" }
      ],
      "role": "user"
    }
  ]
}
```

---

## 实现架构

### 方案选择：复用聊天流 + 扩展消息类型

生图操作通过现有的聊天会话流程处理，后端检测到生图模型时自动切换调用逻辑。

```
用户发送 prompt → 后端检测模型能力 → 调用生图 API → 返回图片 URL/Base64 → 前端渲染图片
```

---

## 分阶段实现计划

### Phase 1: 类型系统扩展

**文件: `packages/frontend/src/types/index.ts`**

```typescript
// 扩展 ChatStreamChunk
export interface ChatStreamChunk {
  type?: 'content' | 'usage' | 'start' | 'end' | 'complete' | 'error' | 'reasoning' | 'quota' | 'tool' | 'image';
  content?: string;
  // 新增：生成的图片
  images?: GeneratedImage[];
  ...
}

// 新增：生成图片类型
export interface GeneratedImage {
  url?: string;           // 图片 URL（优先）
  base64?: string;        // Base64 数据（备选）
  mime?: string;          // MIME 类型
  revisedPrompt?: string; // DALL-E 返回的修正后 prompt
  width?: number;
  height?: number;
}

// 扩展 Message
export interface Message {
  ...
  // 区分用户上传的图片和 AI 生成的图片
  images?: string[];              // 用户上传（保持现有）
  generatedImages?: GeneratedImage[];  // AI 生成（新增）
}
```

**文件: `packages/shared/src/index.ts`**

```typescript
// 导出生图相关类型
export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  n?: number;
  style?: 'vivid' | 'natural';
}
```

---

### Phase 2: 后端生图服务 (只需两个 Provider)

**新增文件: `packages/backend/src/services/image-generation/`**

```
image-generation/
├── index.ts
├── image-generation-service.ts
├── providers/
│   ├── openai-compat.ts      # OpenAI 兼容 API (DALL-E, Nano-GPT, Imagen)
│   └── gemini-generate.ts    # Gemini GenerateContent API (Nano Banana)
└── __tests__/
```

**核心类型:**

```typescript
export interface GeneratedImageData {
  url?: string;
  base64?: string;
  mime?: string;
  revisedPrompt?: string;
}

export interface ImageGenerationResult {
  images: GeneratedImageData[];
  model: string;
  created: number;
}
```

---

#### Provider 1: OpenAI 兼容 API

适用于所有使用 `/v1/images/generations` 端点的服务：
- OpenAI DALL-E
- Nano-GPT
- Google Imagen (兼容端点)
- 其他 OpenAI 兼容服务

```typescript
// providers/openai-compat.ts
export async function generateImageOpenAI(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  n?: number;
  size?: string;
}): Promise<ImageGenerationResult> {
  const response = await fetch(`${params.baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      n: params.n || 1,
      size: params.size || '1024x1024',
      response_format: 'b64_json',
    }),
  });
  
  const data = await response.json();
  return {
    images: data.data.map((img: any) => ({
      url: img.url,
      base64: img.b64_json,
      revisedPrompt: img.revised_prompt,
    })),
    model: params.model,
    created: data.created,
  };
}
```

---

#### Provider 2: Gemini GenerateContent API

适用于 `gemini-2.5-flash-image` 等通过聊天 API 返回图片的模型（Nano Banana 风格）

```typescript
// providers/gemini-generate.ts
export async function generateImageGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
  inputImage?: string;  // base64 data URL for image-to-image
}): Promise<ImageGenerationResult> {
  const parts: any[] = [];
  
  // Image-to-Image: 先放输入图片
  if (params.inputImage) {
    const [header, base64Data] = params.inputImage.split(',');
    const mimeMatch = header.match(/data:([^;]+);/);
    parts.push({
      inlineData: {
        mimeType: mimeMatch?.[1] || 'image/png',
        data: base64Data,
      },
    });
  }
  
  // 文本提示
  parts.push({ text: params.prompt });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': params.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts, role: 'user' }],
      }),
    }
  );
  
  const data = await response.json();
  const images: GeneratedImageData[] = [];
  
  // 从响应中提取图片
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      images.push({
        base64: part.inlineData.data,
        mime: part.inlineData.mimeType,
      });
    }
  }
  
  return { images, model: params.model, created: Date.now() };
}
```

---

#### 服务层：自动选择 Provider

```typescript
// image-generation-service.ts
export class ImageGenerationService {
  async generate(connection: Connection, modelId: string, prompt: string) {
    // 根据模型或连接类型选择 Provider
    if (this.isGeminiImageModel(modelId)) {
      return generateImageGemini({
        apiKey: connection.apiKey,
        model: modelId,
        prompt,
      });
    }
    
    // 默认使用 OpenAI 兼容 API
    return generateImageOpenAI({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      model: modelId,
      prompt,
    });
  }
  
  private isGeminiImageModel(modelId: string): boolean {
    return modelId.includes('gemini') && modelId.includes('image');
  }
}
```

---

### Phase 3: 聊天流集成

**修改文件: `packages/backend/src/api/chat/stream-handler.ts` (或类似)**

在处理聊天请求时检测模型能力：

```typescript
async function handleChatStream(req, res, session, connection) {
  const capabilities = getModelCapabilities(connection, session.modelRawId);
  
  if (capabilities.image_generation) {
    // 切换到生图逻辑
    return handleImageGeneration(req, res, session, connection);
  }
  
  // 正常聊天逻辑
  return handleTextChat(req, res, session, connection);
}

async function handleImageGeneration(req, res, session, connection) {
  const result = await imageGenerationService.generate(
    connection.id,
    session.modelRawId,
    req.body.content
  );
  
  // 发送 SSE 事件
  sendSSE(res, {
    type: 'image',
    images: result.images,
  });
  
  // 保存消息
  await saveGeneratedImages(session.id, result.images);
  
  sendSSE(res, { type: 'complete' });
}
```

---

### Phase 4: 数据库扩展

**Prisma Schema 修改:**

```prisma
model GeneratedImage {
  id          Int      @id @default(autoincrement())
  messageId   Int
  message     Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  url         String?
  storagePath String?  // 本地存储路径（如果下载保存）
  mime        String?
  width       Int?
  height      Int?
  revisedPrompt String?
  createdAt   DateTime @default(now())
  
  @@index([messageId])
}

model Message {
  ...
  generatedImages GeneratedImage[]
}
```

---

### Phase 5: 前端渲染

**修改文件: 消息渲染组件**

```tsx
// 在消息气泡组件中
function MessageBubble({ message }: { message: Message }) {
  return (
    <div>
      {/* 文本内容 */}
      {message.content && <MarkdownRenderer content={message.content} />}
      
      {/* AI 生成的图片 */}
      {message.generatedImages?.length > 0 && (
        <GeneratedImageGallery images={message.generatedImages} />
      )}
    </div>
  );
}

function GeneratedImageGallery({ images }: { images: GeneratedImage[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {images.map((img, idx) => (
        <div key={idx} className="relative group">
          <img 
            src={img.url || `data:${img.mime};base64,${img.base64}`}
            alt={img.revisedPrompt || 'Generated image'}
            className="rounded-lg cursor-pointer"
            onClick={() => openLightbox(img)}
          />
          {img.revisedPrompt && (
            <p className="text-xs text-muted-foreground mt-1">
              {img.revisedPrompt}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
```

**修改流式处理:**

```typescript
// stream-reader.ts 或相关文件
for await (const chunk of parseEventStream(response)) {
  if (chunk.type === 'image') {
    // 更新消息状态，添加生成的图片
    updateMessage(messageId, {
      generatedImages: chunk.images,
    });
  }
  // ... 其他处理
}
```

---

### Phase 6: UI/UX 增强（可选）

1. **模型选择器标识** - 在模型列表中显示生图模型图标
2. **生图参数面板** - 尺寸、质量、风格选择
3. **生成进度指示** - 生图通常需要几秒到几十秒
4. **图片操作** - 下载、放大查看、重新生成

---

## 工作量评估

| 阶段 | 预估工时 | 优先级 |
|------|---------|--------|
| Phase 1: 类型系统 | 2h | P0 |
| Phase 2: 后端服务 | 10h | P0 |
| Phase 3: 流集成 | 4h | P0 |
| Phase 4: 数据库 | 2h | P0 |
| Phase 5: 前端渲染 | 6h | P0 |
| Phase 6: UX 增强 | 6h | P1 |

**总计**: 约 30 小时

---

## 总结：两种 API，两个 Provider

| API 类型 | Provider | 适用服务 | 端点 |
|----------|----------|----------|------|
| **OpenAI 风格** | `openai-compat.ts` | DALL-E, Nano-GPT, Imagen 兼容 | `/v1/images/generations` |
| **Gemini 风格** | `gemini-generate.ts` | Gemini Flash Image (Nano Banana) | `:generateContent` |

### 模型对照表

| 模型 | 使用的 Provider | Image-to-Image |
|------|-----------------|----------------|
| `dall-e-3` | OpenAI 风格 | ❌ |
| `gpt-image-1.5` | OpenAI 风格 | ✅ |
| `hidream` | OpenAI 风格 | ❌ |
| `flux-kontext` | OpenAI 风格 | ✅ |
| `imagen-4.0-generate-001` | OpenAI 风格 | ❌ |
| **`gemini-2.5-flash-image`** | **Gemini 风格** | ✅ |

---

## 测试计划

1. **单元测试** - 生图服务的各 provider
2. **集成测试** - 完整的聊天→生图→渲染流程
3. **E2E 测试** - 模拟用户使用生图模型

---

## 风险与注意事项

1. **API 差异** - 不同生图 API 接口差异大，需要抽象层
2. **成本控制** - 生图 API 通常按次计费，需要配额管理
3. **响应时间** - 生图需要 5-30 秒，需要良好的加载状态
4. **图片存储** - 是否持久化保存生成的图片，存储成本
5. **内容审核** - 生图内容可能需要审核机制

---

## API 认证方式

### OpenAI
```
Authorization: Bearer {OPENAI_API_KEY}
```

### Google Gemini/Imagen
```
# OpenAI 兼容端点
Authorization: Bearer {GEMINI_API_KEY}

# 原生端点
x-goog-api-key: {GEMINI_API_KEY}
```

### Nano-GPT
```
Authorization: Bearer {NANO_GPT_API_KEY}
# 或
x-api-key: {NANO_GPT_API_KEY}
```

---

## 错误处理

### 常见错误码

| 错误码 | 含义 | 处理方式 |
|--------|------|----------|
| 400 | 无效参数/提示词 | 提示用户修改输入 |
| 401 | API Key 无效 | 提示配置正确的密钥 |
| 429 | 请求频率限制 | 实现退避重试 |
| 500 | 服务器错误 | 重试或降级 |

### 内容审核错误 (OpenAI)
```json
{
  "error": {
    "code": "content_policy_violation",
    "message": "Your request was rejected as a result of our safety system."
  }
}
```
需要在 UI 中友好地提示用户修改提示词。

---

## 下一步

1. **Phase 1**: 扩展类型系统 (`ChatStreamChunk`, `Message`, `GeneratedImage`)
2. **Phase 2**: 实现 `ImageGenerationService` 和 Provider 抽象
3. **Phase 3**: 集成到聊天流程，检测 `image_generation` 能力
4. **Phase 4**: 添加数据库表存储生成的图片
5. **Phase 5**: 前端渲染组件 (`GeneratedImageGallery`)
6. **Phase 6**: UX 增强（参数选择、进度指示、图片操作）

### 推荐实现顺序

```
1. OpenAI DALL-E 3 (最稳定，文档完善)
2. Google Imagen (OpenAI 兼容端点，复用相同调用逻辑)
3. Nano-GPT (OpenAI 兼容端点)
4. Gemini Flash Image (image-to-image 风格转换)
5. 其他 Provider
```

### Provider 选择策略

系统应根据 Connection 的 `provider` 和 `baseUrl` 自动选择正确的 Provider：

```typescript
function selectImageProvider(connection: Connection, modelId: string): ImageGenerationProvider {
  // Google Gemini/Imagen
  if (connection.baseUrl?.includes('generativelanguage.googleapis.com')) {
    if (modelId.startsWith('imagen-')) {
      return new GoogleImagenProvider();
    }
    if (modelId.startsWith('gemini-') && modelId.includes('image')) {
      return new GeminiFlashImageProvider();
    }
  }
  
  // Nano-GPT
  if (connection.baseUrl?.includes('nano-gpt.com')) {
    return new NanoGptProvider();
  }
  
  // OpenAI 及兼容服务
  if (connection.provider === 'openai' || connection.provider === 'openai_responses') {
    return new OpenAIDalleProvider();
  }
  
  // 默认使用 OpenAI 兼容调用
  return new OpenAIDalleProvider();
}
```