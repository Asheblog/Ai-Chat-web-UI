# 供应商协议合并 + Anthropic Messages 支持实施计划

> **For agentic workers:** 本计划按任务逐项实施；每个任务以可独立验证的测试收口。步骤使用 checkbox 跟踪。

**Goal:** 把「OpenAI」与「OpenAI Responses」两张供应商卡合并为一张可选协议的卡，并新增 Anthropic Messages 协议连接；配置、验证、模型目录、聊天流式/非流式、工具调用与推理链路全部可用。

**Architecture:** 前端只保留三个供应商卡（OpenAI / Google / Anthropic），OpenAI 卡内提供协议选择（Chat Completions / Responses），协议仍落为现有 `provider` 值 `openai` / `openai_responses`，避免数据迁移。后端新增 `anthropic` 协议：请求侧把内部 OpenAI Chat Completions 形状转换为 Anthropic Messages；响应侧把 Messages JSON 与 SSE 事件归一化回内部 OpenAI 形状，使既有流式解析、工具编排、用量统计无需重写。

**Tech Stack:** TypeScript, Hono, Prisma, Next.js 15, React 18, Vitest, Jest, Tailwind。

**Spec:** 用户需求（2026-11-12）：合并 OpenAI 双卡为协议选择；新增 Anthropic message 接口；仍是三个卡；新分支实施，合并 main，推送并确保 CI 通过。

## Global Constraints

- 文件 UTF-8 无 BOM；代码风格遵循现有仓库。
- 不引入新依赖。
- 不破坏既有 `openai` / `openai_responses` / `google_genai` 连接的读写与调用。
- Anthropic 使用 `POST {baseUrl}/messages`、`x-api-key`、`anthropic-version: 2023-06-01`。
- Anthropic 流式事件必须转换为内部 OpenAI chunk，避免改动既有 SSE 消费方。
- UI 变更必须通过 `ui-ux-pro-max` 检查并留下页面截图证据。
- 完成后合并到 `main`、推送、监督 GitHub Actions `quality` job。

## Review Focus

- 已有 `openai_responses` 连接在合并卡片后仍能编辑、验证、调用。
- Anthropic 工具循环：`tool_use` → OpenAI `tool_calls` → `tool_result` 回传的角色/块结构。
- Anthropic 流式用量与 stop_reason 映射后，前端 usage/finish 状态正常。
- 图片 data URL 转 Anthropic base64 image block；非 data URL 走 url source。
- 协议切换后 Thinking 方言、Base URL 提示、模型能力推断不串台。

---

### Task 1: 后端协议基础

**Files:**
- Modify: `packages/backend/src/utils/providers.ts`
- Modify: `packages/backend/src/services/context/context-window-service.ts`
- Modify: `packages/shared/src/model-display.ts`
- Modify: `packages/backend/prisma/schema.prisma`
- Test: `packages/backend/src/utils/__tests__/providers.test.ts`（新建或补充）

**Interfaces:**
- Produces: `ProviderType` 包含 `'anthropic'`；`buildHeaders` 对 Anthropic 返回 `x-api-key` 与 `anthropic-version`；`verifyConnection` / `fetchModelsForConnection` 支持 Anthropic `/models`。

- [x] Step 1: 写失败测试：Anthropic headers 含 `x-api-key`、`anthropic-version`；允许 extra header 覆盖 version；`/models` 解析 `{ data: [{ id, display_name }] }`。
- [x] Step 2: 跑测试确认失败。
- [x] Step 3: 扩展 `SUPPORTED_PROVIDERS`、headers、verify、fetchModels；新增 Anthropic 上下文窗口规则与 provider label。
- [x] Step 4: 跑测试转绿。
- [x] Step 5: 提交。

### Task 2: Anthropic Messages 适配层

**Files:**
- Create: `packages/backend/src/utils/anthropic.ts`
- Create: `packages/backend/src/utils/__tests__/anthropic.test.ts`

**Interfaces:**
- Produces:
  - `convertChatCompletionsRequestToAnthropic(body: any): any`
  - `convertAnthropicMessageToChatCompletion(json: any): any`
  - `createAnthropicSseToOpenAIStream(): TransformStream<Uint8Array, Uint8Array>`
  - `adaptProviderResponse(response: Response, provider: string, stream: boolean): Promise<Response>`
  - `readProviderJson<T>(response: Response, provider: string): Promise<T>`

- [x] Step 1: 写失败测试：system 提取、tool_calls→tool_use、tool→tool_result、图片 data URL→base64、tools schema、thinking budget 严格小于 max_tokens。
- [x] Step 2: 写失败测试：非流式 message→choices 映射（text/tool_use/usage/stop_reason）。
- [x] Step 3: 写失败测试：SSE 事件序列→OpenAI chunk（role、text、reasoning、tool_calls 分片、usage、[DONE]）。
- [x] Step 4: 实现 `anthropic.ts` 使测试转绿。
- [x] Step 5: 提交。

### Task 3: 聊天链路接入

**Files:**
- Modify: `packages/backend/src/utils/chat-provider.ts`
- Modify: `packages/backend/src/agent-runtime/provider-requester.ts`
- Modify: `packages/backend/src/agent-runtime/provider-adapters.ts`
- Modify: `packages/backend/src/agent-runtime/tool-protocol.ts`
- Modify: `packages/backend/src/modules/chat/services/non-stream-fallback-service.ts`
- Modify: `packages/backend/src/modules/chat/services/title-summary-service.ts`
- Modify: `packages/backend/src/modules/chat/services/conversation-compression-service.ts`
- Modify: `packages/backend/src/services/vision/vision-proxy-service.ts`
- Modify: `packages/backend/src/modules/chat/agent-web-search-response.ts`
- Modify: `packages/backend/src/api/openai-compatible.ts`
- Modify: `packages/backend/src/modules/chat/routes/control.ts`
- Modify: `packages/backend/src/services/battle/battle-executor.ts`
- Test: 对应既有测试文件补充 Anthropic 分支。

**Interfaces:**
- Consumes: Task 2 的适配函数。
- Produces: 所有 provider 请求路径对 `anthropic` 可用；流式请求统一经 `ProviderRequester` 归一化。

- [x] Step 1: 写失败测试：`buildChatProviderRequest('anthropic')` 返回 `/messages` 与 Anthropic body。
- [x] Step 2: 写失败测试：`ProviderRequester` 对 Anthropic 流式响应归一化；非流式 JSON 归一化。
- [x] Step 3: 实现 `buildChatProviderRequest` 分支、请求器响应适配、工具适配器、原生 tools 判定。
- [x] Step 4: 把直接 fetch 的调用点改为共享适配函数，并让流式启用条件包含 Anthropic。
- [x] Step 5: 跑相关测试转绿；提交。

### Task 4: 前端三卡与协议选择

**Files:**
- Modify: `packages/frontend/src/components/settings/system-connections/provider-templates.ts`
- Modify: `packages/frontend/src/components/settings/system-connections/provider-template-card.tsx`
- Modify: `packages/frontend/src/components/settings/system-connections/SystemConnectionEditor.tsx`
- Modify: `packages/frontend/src/components/settings/system-connections/SystemConnectionsPageParts.tsx`
- Modify: `packages/frontend/src/components/settings/system-connections/view-model.ts`
- Modify: `packages/frontend/src/components/settings/pages/SystemConnections.tsx`
- Test: `packages/frontend/src/components/settings/__tests__/system-connections-page.test.tsx`
- Test: `form-state.test.ts`

**Interfaces:**
- Produces: `PROVIDER_TEMPLATES` 三项；OpenAI 项含 `protocols`；`ProviderTemplateCard` 在 OpenAI 卡内提供协议 `select` 与独立配置按钮；向导第 2 步提供「接口协议」选择。

- [x] Step 1: 写失败测试：模板共 3 项；OpenAI 卡连接数合并 `openai`+`openai_responses`；选择 Responses 后提交 `provider='openai_responses'`。
- [x] Step 2: 写失败测试：Anthropic 模板 baseUrl 与 label；编辑已有 `openai_responses` 时协议选择回显 Responses。
- [x] Step 3: 实现模板/卡片/编辑器/标签/占位符；保证卡片无嵌套交互元素。
- [x] Step 4: 跑前端测试转绿。
- [x] Step 5: 用 `ui-ux-pro-max` 检查，起 dev server 截图验收；提交。

### Task 5: 文档与最终验证

**Files:**
- Modify: `CONTEXT.md`
- Modify: `CHANGELOG.md`
- Modify: 本计划文件（勾选）

- [x] Step 1: 更新 Supported Provider Protocol 定义与变更日志。
- [x] Step 2: 跑后端 Jest、前端 Vitest、后端/前端 type-check、architecture check。
- [x] Step 3: `code-review` 双轴审查并修复。
- [x] Step 4: 合并 main、推送、监督 GitHub Actions。
