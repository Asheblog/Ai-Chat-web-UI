# Read URL v2 设计稿

## 背景与问题

当前 `read_url` 采用 `fetch + jsdom + Readability` 的静态正文提取，面对动态页面、挑战页和图片证据场景时稳定性不足。

已确认的主要缺口：
- 缺少标准化图片证据字段，导致前端无法稳定展示外部网页图片。
- 搜索命中结构未保留图片元数据（例如 `imageUrl`/`thumbnail`），只保留文本摘要。
- 正文读取结果虽然有回退策略，但缺少“页面主图 + 正文图”的结构化输出。

## 目标

在不引入重型浏览器依赖的前提下，直接替换为 `read_url v2`：
- 提升静态可读页面成功率与可解释性（错误码/回退来源）。
- 输出结构化图片证据（主图 + 正文候选图）。
- 让 `web_search -> tool log -> rich payload` 链路能够稳定携带图片。

## 方案对比

### 方案 A：仅调大超时和重试
- 优点：改动最小。
- 缺点：不能解决“无图片字段”核心问题，对动态站点提升有限。

### 方案 B：引入浏览器渲染（Playwright）
- 优点：动态站读取能力最好。
- 缺点：部署体积、运行资源、跨平台维护成本高（尤其 Windows 生产部署）。

### 方案 C（采用）：静态管线增强 + 图片证据标准化
- 优点：改动可控、Linux/Windows 部署友好、立刻解决图片字段缺失。
- 缺点：对强 JS 站点仍可能失败（但可回退并清晰报错）。

## 详细设计

### 1. `UrlReadResult` 增加图片证据
新增字段：
- `leadImageUrl?: string`：页面主图（优先 `og:image` / `twitter:image`）。
- `images?: Array<{ url: string; alt?: string; width?: number; height?: number; source: 'meta' | 'content' | 'crawler' }>`：去重后的候选图片。

提取策略：
- 元信息优先：`meta[property=og:image]`、`meta[name=twitter:image]`。
- 正文图补充：从 Readability/候选正文节点内提取 `<img>`，过滤明显无效图标、像素图、base64 大垃圾项。
- URL 归一化：支持相对路径、协议相对 URL，统一为绝对 URL。

### 2. `WebSearchHit` 增加图片字段
新增字段：
- `imageUrl?: string`
- `thumbnailUrl?: string`

各搜索引擎 mapping：
- Metaso：保留返回中的 `imageUrl`/`thumbnail`。
- Brave/Tavily：尽可能从返回对象兜底映射常见字段。

### 3. Tool 日志与富文本证据链路打通
- `web_search` 事件中的 `hits` 直接携带新增图片字段。
- `read_url` 成功事件在 `details.images` 中写入精简图片证据（限制数量，避免上下文膨胀）。
- `rich-payload` 继续复用现有图片键抽取逻辑，无需前端协议破坏性改动。

### 4. 输出格式增强
`formatUrlContentForModel` 新增“图片证据”小节，给模型可消费的可读摘要（主图 + 若干候选图），并保留当前正文输出。

## 错误处理

- 不改变现有错误码体系，仅增强成功结果结构。
- 若图片提取失败，不影响正文提取成功判定。

## 测试策略

采用 TDD：
1. 先写失败测试：`readUrlContent` 返回图片字段。
2. 先写失败测试：`formatUrlContentForModel` 含图片证据文本。
3. 先写失败测试：`runMetasoSearch`/`parseToolLogsJson` 保留 `imageUrl`。
4. 最小实现通过后再重构。

## 迁移策略

无迁移、直接替换。
- 新字段为增量输出，不影响旧调用方读取基础字段。
- 旧日志与旧消息体仍可被解析。
