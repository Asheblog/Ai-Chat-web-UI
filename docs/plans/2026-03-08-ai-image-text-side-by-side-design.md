# AI 回复图文并排（含分享页）设计方案

## 1. 背景与目标

目标：让 AI 回复支持“图文并排”展示，并且在分享页保持同等视觉与语义一致性，提升可读性与展示能力（尤其是联网搜索/文档问答场景中的“证据图片 + 答案解释”）。

本次设计范围：
- 仅覆盖 `assistant` 消息。
- 主聊天页与分享页统一渲染行为。
- 支持流式过程中的稳定展示（文本先到、图片后到）。
- 桌面端并排，移动端自动堆叠。
- 仅在开启对应能力时进入“证据图文模式”：如联网搜索、文档问答（RAG）。

非目标：
- 不改造用户消息输入区的多栏编辑器。
- 不引入 WYSIWYG 编辑体验。

---

## 2. 现状审计（基于当前仓库）

### 2.1 聊天主界面
- `packages/frontend/src/components/message-bubble/message-body-content.tsx`
  - 用户消息：`meta.images` 在文本上方展示。
  - AI 消息：仅在“内容是 markdown 且命中 `![Generated Image N](data:image...)` 模式”时走图片专门渲染。
  - 问题：真正的 `generatedImages`（流式 `image` chunk）并没有在该组件消费。
- `packages/frontend/src/features/chat/store/slices/stream-slice.ts`
  - 收到 `type: 'image'` 会写入 `messageMeta.generatedImages` 和 `messageBody.generatedImages`。
  - 但最终 UI 没有使用该字段，导致状态与渲染脱节。

### 2.2 分享页
- `packages/frontend/src/components/share/share-viewer.tsx`
  - 先渲染 markdown 文本，再单独渲染 `msg.images` 网格。
  - 没有“图文并排”布局，也没有统一复用聊天主界面的富内容渲染。

### 2.3 后端数据层
- `packages/backend/src/modules/chat/services/message-query-service.ts`
  - 只读取 `attachments`（用户上传图片），不读取 `generated_images`。
- `packages/backend/src/services/shares/share-service.ts`
  - 分享快照只写 `content + images + toolEvents`，缺少“结构化图文块”语义。

结论：当前系统存在“图片状态已采集但未统一渲染、分享与主聊天表现不一致、后端消息模型不含结构化图文块”的链路断点。

---

## 3. LobeHub 本地参考结论（`.tmp_research/lobe-chat`）

观察到的可借鉴点：
- 使用 `MessageContentPart[]`（`text` / `image`）表达多模态内容。
  - `packages/types/src/message/common/base.ts`
  - `packages/utils/src/multimodalContent.ts`
- 渲染层支持从序列化内容反序列化后统一渲染。
  - `src/features/Conversation/Messages/components/DisplayContent.tsx`
  - `src/features/Conversation/Messages/components/RichContentRenderer.tsx`
- 分享页复用 Conversation 渲染链。
  - `src/app/[variants]/share/t/[id]/SharedMessageList.tsx`

可迁移原则：
1. 用结构化内容表达图文关系，不依赖 markdown 正则猜测。
2. 聊天页与分享页复用同一渲染组件，避免分叉。
3. 流式阶段和落库阶段使用同一语义模型，避免“中途能看见，刷新消失”。

---

## 4. 方案对比

### 方案 A：仅前端补丁（最小改动）
- 做法：在 `message-body-content.tsx` 中消费 `generatedImages`，按两列布局渲染；分享页继续独立拼接。
- 优点：开发快。
- 缺点：分享页与主界面仍易分叉；结构语义不足；后续维护成本高。

### 方案 B：Lobe 风格 `content` 序列化 JSON（中改动）
- 做法：将 `content` 在多模态场景写成 JSON 字符串数组。
- 优点：实现路径短。
- 缺点：`content` 语义混杂（文本语义与渲染语义耦合），上下文/计费/token 处理风险增大。

### 方案 C（推荐）：结构化图文块 + 统一渲染器（重构型）
- 做法：新增结构化块字段，聊天与分享统一消费；删除旧的正则兜底和分叉渲染。
- 优点：正确性高、可维护、可测试，后续可扩展视频/文件卡片。
- 缺点：涉及前后端与快照结构改造，实施成本较高。

---

## 5. 推荐方案（C）详细设计

## 5.1 数据契约（前后端统一）

新增消息块模型：

```ts
export type RichMessagePart =
  | { type: 'text'; text: string; format: 'markdown' }
  | {
      type: 'image'
      url: string
      alt?: string
      width?: number
      height?: number
      source: 'generated' | 'attachment' | 'external'
    }

export interface RichMessagePayload {
  layout: 'auto' | 'side-by-side' | 'stack'
  parts: RichMessagePart[]
}
```

接口替换策略（不保持向后兼容）：
- 聊天消息接口与分享消息接口统一返回 `richPayload`。
- 逐步删除对 `images` / `generatedImages` 的前端直接消费。

## 5.2 持久化策略

建议在 `Message` 增加字段（或等价 JSON 扩展字段）：
- `richPayloadJson TEXT`（存 `RichMessagePayload`）

落库规则：
- 纯文本回复：`layout=auto`，`parts=[text]`
- 图文回复：`layout=side-by-side`，`parts=[text, image...]`
- 仅图片回复：`layout=stack`，`parts=[image...]`

`generated_images` 表继续保留为图片资产来源，不直接承载展示布局语义。

## 5.3 后端改造点

1. `chat-stream-use-case` / `image-generation-response`
- 在流式完成时构建 `richPayload` 并持久化。
- `image` chunk 到达后合并到消息的 `parts`（而非仅写临时字段）。

2. `message-query-service`
- 查询时优先返回 `richPayload`。
- 若无（仅迁移期），可由 `content + generated_images + attachments` 组装。

3. `share-service`
- 分享快照改为持久化 `richPayload`，不再仅 `content + images`。

4. 路由响应类型
- `/chat/sessions/:id/messages`
- `/api/shares/:token`
- `/api/shares/:token/messages`

统一输出结构化图文消息。

## 5.4 前端改造点

新增统一渲染组件（聊天页+分享页共用）：
- `RichMessageRenderer`（建议放在 `packages/frontend/src/components/message-content/`）

布局规则：
- `layout=side-by-side` 且同时存在 text+image 时：
  - `>=1024px`：左右并排（文本 7/12，媒体 5/12）
  - `<1024px`：上下堆叠（文本在上，媒体在下）
- 多图：媒体区内使用 1-2 列自适应网格，保持等高裁切+可点击放大。
- 仅图：使用网格卡片；仅文：退化为 markdown 渲染。

替换点：
- `message-bubble/message-body-content.tsx`
- `share/share-viewer.tsx`

删除/下线（过时代码）：
- `GENERATED_IMAGE_PATTERN` 正则提取路径（markdown data-url 专用分支）
- 主/分享两套重复的“先文后图”拼装逻辑
- 未接入主链路的冗余图片展示组件（若功能重复则移除）

## 5.4A 能力驱动的显示样式（本次补充重点）

本节定义“你提到的场景”如何展示：当 AI 开启联网搜索或文档问答能力时，消息展示进入证据图文模式。

### 触发条件（UI 层）

- `web_search` 工具调用成功且返回可用图片证据（网页缩略图/抓取图）。
- `document_search` / `kb_search` 返回文档页图、图表截图、插图等证据。
- 至少满足：`parts` 中同时存在 `text + image`，并且 `source in ('generated','external','attachment')`。

若仅有文本或仅有图片，不强制并排，自动退化为单栏。

### 推荐主样式：Evidence Split（证据分栏）

#### 桌面端（>=1024px）

```text
┌──────────────────────────────────────────────────────────────┐
│ AI 回答卡片                                                  │
│ ┌──────────────────────────────┬───────────────────────────┐ │
│ │ 左栏：答案正文               │ 右栏：证据图片面板        │ │
│ │ - 结论摘要                   │ - 图 1 缩略图             │ │
│ │ - 分点解释                   │   来源站点 + 标题         │ │
│ │ - 与右侧图片编号互链 [图1]   │   [查看原图] [打开来源]    │ │
│ │ - 引用脚注 [S1][S2]          │ - 图 2 ...                │ │
│ └──────────────────────────────┴───────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

布局比例：
- 左栏 `7/12`，右栏 `5/12`
- 外层卡片 `rounded-2xl border bg-background`
- 分栏间距 `gap-4`（大屏 `gap-5`）

#### 移动端（<1024px）

```text
┌──────────────────────────────┐
│ AI 回答卡片                  │
│ 答案正文（先展示）            │
│ ---------------------------- │
│ 证据图片面板（后展示）        │
│ [图1] [图2]                  │
└──────────────────────────────┘
```

顺序固定“先文后图”，避免用户先看图失去上下文。

### 证据图片卡片样式（右栏/下方统一）

每张证据图卡包含：
1. 缩略图（`aspect-[4/3]`，`object-cover`，支持点击放大）
2. 证据标签行（非颜色唯一表达）
   - `来源类型`：`联网` / `文档`
   - `可信度`：`高/中/低`（文字 + 图标）
3. 标题（最多两行）
4. 操作按钮
   - `查看原图`
   - `打开来源`
5. 可选元信息
   - 文档场景：`第 N 页` / `章节名`
   - 联网场景：域名、抓取时间

样式 token（建议）：
- 图卡：`rounded-xl border border-border/70 bg-[hsl(var(--surface))]`
- hover：仅阴影/边框变化，不做位移缩放导致布局抖动
- 焦点：`focus-visible:ring-2 focus-visible:ring-primary`

### 文本与证据互链样式

- 正文引用格式：`[图1]`、`[图2]`
- 悬停正文引用时，高亮对应图卡边框
- 悬停图卡时，高亮正文中的对应引用标记
- 键盘操作支持双向跳转（`Enter` 聚焦目标）

### 场景化模板

#### 模板 A：联网搜索回答

- 左栏：`结论 -> 证据解释 -> 风险提示`
- 右栏：站点证据图（最多 4 张，超出折叠“查看更多”）
- 卡片顶部增加“已联网检索 N 个来源”状态条

#### 模板 B：文档问答回答

- 左栏：`答案 -> 文档定位说明（页码/段落）`
- 右栏：文档截图证据（按页码排序）
- 每张图卡显示“页码 + 文档名”，点击可跳转到文档预览位置（后续能力）

### 分享页一致性要求（必须）

- 分享页复用同一 `RichMessageRenderer`，禁止再维护独立“先 markdown 后 images”的分叉模板。
- 分享页仅隐藏交互型写操作（如反馈/编辑），保留阅读交互：
  - 看大图
  - 打开来源
  - 文本与图片互链高亮

### 流式状态样式

在图片尚未返回时：
- 右栏显示 1~2 个骨架图卡（skeleton）
- 左栏正文可先行渲染
- 收到首张证据图后，骨架位平滑替换为真实图卡

避免“整卡闪烁重排”规则：
- 外层分栏容器在流式期保持固定结构
- 仅替换右栏内部 item

## 5.5 交互与可访问性

- 所有可点击图片支持键盘触达（`tabIndex` + `Enter/Space`）。
- 焦点态统一 `focus-visible:ring-2`。
- 动效遵守 `prefers-reduced-motion`。
- 图片 `alt` 必填（无业务文案时使用“AI 生成图片 N”）。
- 保证移动端无横向滚动。

## 5.6 性能与稳定性

- 复用现有虚拟列表，估算高度时纳入图片数量与布局模式。
- 图片懒加载与 lightbox 解耦，避免首屏阻塞。
- 流式更新采用“块级增量”合并，避免整段 markdown 重算。

## 5.7 Linux / Windows 兼容要求

- 文件存储路径仅在服务端内部使用 `path.join`。
- 对外持久化与返回的相对路径统一使用 POSIX `/` 分隔，不写入 `\\`。
- URL 拼接统一使用 URL/字符串标准化，避免平台差异导致分享页图片 404。

---

## 6. 验收标准（DoD）

1. AI 文本+图片回复在聊天页桌面端并排展示，移动端自动堆叠。
2. 同一条消息在分享页展示效果与聊天页一致。
3. 刷新页面后图文布局不丢失（来自持久化 `richPayload`）。
4. 图片可键盘操作、可放大预览，焦点态可见。
5. 375/768/1024/1440 四档无横向滚动。

---

## 7. 测试计划

后端：
- `message-query-service.test.ts`
  - 覆盖 `richPayload` 查询与回退组装。
- `share-service.test.ts`
  - 覆盖分享快照保存/读取 `richPayload`。

前端：
- `share-viewer.test.tsx`
  - 增加图文并排渲染断言。
- 新增 `RichMessageRenderer` 单测
  - `text-only / image-only / mixed / responsive class`。
- 流式状态测试
  - `image chunk` 到达后布局从 `text-only` 变 `side-by-side`。

---

## 8. 迁移方案

本需求采用：**有迁移，接口直接替换（不保持向后兼容）**

迁移步骤：
1. 数据库新增 `richPayloadJson`。
2. 一次性脚本回填历史消息：
   - `parts.text <- content`
   - `parts.image <- generated_images + attachments`
   - `layout <- auto/side-by-side`（按是否同时含 text+image 推导）
3. 前后端切换到 `richPayload` 读取。
4. 删除旧渲染分支与冗余字段消费逻辑。

PR 中需明确写明：
- 这是一次接口替换；旧字段消费代码已移除。
- 提供迁移脚本执行说明与回滚预案。

---

## 9. 实施拆分建议

- Task 1：定义类型与 API 契约（前后端共享）
- Task 2：后端 `richPayload` 持久化与查询
- Task 3：前端统一渲染器接入聊天页
- Task 4：分享页复用统一渲染器
- Task 5：清理旧分支 + 回归测试
