# 移除图片转写（Vision Transcription Proxy）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「图片转写代理」从代码、类型、配置、数据库、前端界面与文档中彻底移除，使仓库回到「图片一律直接发给主模型」的单一链路。

**Architecture:** 按调用链自外向内剥离：先断开编排层与请求构建对转写服务的调用，再移除联网证据图对转写模型的相关性判定，然后下线设置链路与管理员探针，之后删除核心服务与 `analyze_visual_media` 工具，最后清数据库列、前端界面与文档。每个任务结束时仓库都能通过自身类型检查，不留半截引用。

**Tech Stack:** TypeScript / Hono / Prisma(SQLite) / Next.js 15 + React / jest（后端）/ vitest（前端）/ pnpm workspace（`packages/shared` 是前后端共享契约源）。

**Spec:** 无独立设计文档。依据为用户本轮需求（「模型都有了识图能力，图片转写可以删，要删干净」）+ 现有功能定义 `CONTEXT.md:63,116,119-121`。删除决策见下节。

## Decisions（执行者不得自行更改，改动需回报）

- **D1 联网证据图**：`read_url` / `web_search` 的图片相关性判定整条删除，两处回退到「未配置转写代理」时的既有分支 —— `includeRawImageEvidence: true` 输出原始图片 URL 列表，不再下载图片、不再产出 `relevance` / `confidence` / `description` 字段。保留 `utils/remote-image-reader.ts`（`export-pdf-handler.ts` 与 `read_url` 的 vision followup 仍在用）。
- **D2 历史数据**：新迁移 `DROP COLUMN messages.image_descriptions_json` 并 `DELETE FROM system_settings WHERE key GLOB 'image_transcription_*'`（用 `GLOB` 而非 `LIKE`：SQLite 的 `LIKE` 里 `_` 是单字符通配且不分大小写，会误伤 `image-transcription_*` 与 `IMAGE_TRANSCRIPTION_*`）。历史消息丢失「图片描述由 X 转写」文本，图片附件本身不动。
- **D3 `mainModelVision` 参数一并删除**：它唯一的存在理由是配合转写（决定「无 vision 主模型不吃图」）。删除后图片一律透传，等同转写功能上线前行为。
- **D4 `resolveModelCapabilitiesForSession` 保留**：`agent-web-search-response.ts:610` 仍用它给工具上下文注入 `modelCapabilities`（`read_url` 直接把网页图附给主模型的路径），与转写无关。
- **D5 历史 plan 文档保留**：`docs/superpowers/plans/2026-08-04-vision-transcription-proxy.md`、`docs/plans/2026-08-17-image-transcription-probe*.md` 作为开发历史不动，另在 `docs/plans/` 新增本次移除记录。

## Global Constraints

- 文件 UTF-8 无 BOM；宿主为 Windows + pwsh 7，命令一律用 `pnpm`，不写死 Windows 路径。
- 包名过滤用目录名：`pnpm --filter backend …`、`pnpm --filter frontend …`、`pnpm --filter @aichat/shared …`。
- 不保留向后兼容：被删的导出、参数、接口、设置键、DB 列一律真删，不写 deprecated 别名、不写「暂时保留」分支。
- 每个任务结束必须通过该任务列出的检查；失败按报错修，不注释掉代码换绿。
- 提交信息用 `refactor(chat): …` / `chore: …` / `docs: …` 前缀，中文描述，一个任务一个 commit。
- 不新增依赖。

## Review Focus

审查时优先核对这些「测试没覆盖但真实用户会撞」的路径：

1. **旧会话消息**：删列后历史消息接口不再返回 `imageDescriptions`，前端旧缓存/旧分享页渲染该字段为 `undefined` 时必须静默不渲染提示条，不抛错。
2. **纯文本模型直连发图**：`isVisionEnabled` 只在 UI 层拦；API 直连仍可带图，此时上游报错应原样透传，不应由本地返回 500 或静默丢图。
3. **无图网页**：`read_url` 读纯文本页时，「图片证据」段与空行都不应出现（原来 `assessedImages` 为空时靠 `length > 0` 兜住，回退后要保住这个判断）。
4. **设置页深链**：删除「图片转写」叶子后，`/settings?leaf=image-transcription`（旧书签/旧前端缓存）应回退到默认叶子，不白屏、不抛 `leafComponentMap` undefined。
5. **旧客户端写设置**：旧前端仍可能 POST `imageTranscriptionEnabled`，`serializeSystemSettingsPatch` 必须忽略未知键并返回 200，不能 400 或写脏键。

---

## 文件结构总览

**删除（10 个源码 / 8 个测试）**
```
packages/backend/src/services/vision/vision-proxy-service.ts
packages/backend/src/services/vision/vision-image-prepare.ts
packages/backend/src/modules/chat/services/vision-proxy-service.ts        (兼容 shim)
packages/backend/src/modules/chat/services/vision-image-prepare.ts        (兼容 shim)
packages/backend/src/modules/chat/tool-handlers/vision-proxy-handler.ts
packages/backend/src/services/settings/image-transcription-probe-service.ts
packages/backend/src/services/settings/vision-probe-image.ts
packages/backend/src/utils/web-image-evidence.ts
packages/frontend/src/components/settings/pages/model-connections/ImageTranscriptionCard.tsx
packages/frontend/src/components/settings/pages/model-connections/image-transcription-probe-result.tsx
```

**修改**：见各任务 Files 段。**新增**：`packages/backend/prisma/migrations/20261113120000_remove_image_transcription/migration.sql`、`docs/plans/2026-11-13-remove-image-transcription.md`。

---

### Task 1: 编排层与请求构建断开转写调用

**Files:**
- Modify: `packages/backend/src/modules/chat/use-cases/chat-stream-use-case.ts`（import 66-76、deps 139/157、logic 478-576、传参 835/843-844）
- Modify: `packages/backend/src/agent-runtime/chat-request-builder.ts`（param 类型 82-91、常量 139-141、245/254、262-266、330、345-353）
- Modify: `packages/backend/src/modules/chat/agent-web-search-response.ts`（import 83、params 124/131-132、698/709）
- Modify: `packages/backend/src/index.ts:130`
- Test: `packages/backend/src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts`、`packages/backend/src/modules/chat/services/__tests__/chat-request-builder.test.ts`、`packages/backend/src/modules/chat/routes/__tests__/research-plan-respond.test.ts`

**Interfaces:**
- Consumes: 无（本任务是链路最外层）。
- Produces: `PrepareChatRequestParams` 不再有 `mainModelVision` / `visionTranscriptionPrefix` / `visionAttachmentImageCount` / `historyImageDescriptions`；`prepare()` 一律透传 `params.images`；`ChatStreamRoutesDeps` 不再有 `visionProxyService`；`AgentWebSearchResponseParams` 不再有 `visionProxy` / `visionProxyConfig` / `visionProxyService`。Task 4 依赖这四个签名已收敛。

- [ ] **Step 1: 改写失败用例（红）**

在 `chat-stream-use-case.test.ts` 删除 3 个 vision 用例（`auto-transcribes images…`、`passes visionAttachmentImageCount…`、`does not pass visionAttachmentImageCount…`），把它们替换为一条行为用例：

```ts
it('passes images straight through without any transcription step', async () => {
  ;(mockPrepare as jest.Mock).mockResolvedValue(basePreparedResponse)
  await handler(c.buildRequest({ images: [{ data: 'aGk=', mime: 'image/png' }] }))
  const prepareArg = mockPrepare.mock.calls[0][0]
  expect(prepareArg.images).toEqual([{ data: 'aGk=', mime: 'image/png' }])
  expect(prepareArg).not.toHaveProperty('mainModelVision')
  expect(prepareArg).not.toHaveProperty('visionTranscriptionPrefix')
  expect(prepareArg).not.toHaveProperty('visionAttachmentImageCount')
  expect(prepareArg).not.toHaveProperty('historyImageDescriptions')
  expect(mockPrisma.message.update).not.toHaveBeenCalled()
})
```

`chat-request-builder.test.ts` 删除两条 `analyze_visual_media` 注入断言，替换为：无 `visionTranscriptionPrefix` 时用户消息前缀不含「图片转写描述」。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter backend test -- src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts src/modules/chat/services/__tests__/chat-request-builder.test.ts`
Expected: FAIL —— `prepareArg` 仍带四个字段，且 `message.update` 被调用过。

- [ ] **Step 3: 删实现**

`chat-stream-use-case.ts`：删除 478-576 整段（`visionProxyConfig` 计算、`hasImages`/`mainModelCapabilities`/`mainModelVision`/`visionProxyRequested`/`preAgentToolFlags`/`visionProxyToolFlow`/`visionProxyAutoTranscribe`、`visionTranscriptionPrefix`/`payloadImages`/`historyImageDescriptions`），`prepare()` 的 `images` 直接传入参 `images`，删除四个参数行；删除 `toolFlags.visionProxy`、`visionProxyConfig`、`visionProxyService` 三个传参；删除 `deps.visionProxyService` 字段与解构，删除 66-73 的 vision 导入。

`chat-request-builder.ts`：删除四个 param 字段及 `buildVisionAttachmentHint` / `ImageDescription` 导入；`buildMessagesPayload(contextMessages, params.content, params.images ?? [])`；`cacheSafePrefix` 只留 `ragUserPrefix + [当前时间]`；`buildContextMessages` 删 `mainModelVision` 与 `historyImageDescriptions` 参数及 `injectHistoryDescriptions`。

`agent-web-search-response.ts`：删 `visionProxy` / `visionProxyConfig` / `visionProxyService` 三个字段与两处透传。

`index.ts`：`streamRoutes` 里删 `visionProxyService: container.visionProxyService`。

- [ ] **Step 4: 跑测试与类型检查确认通过**

Run: `pnpm --filter backend test -- src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts src/modules/chat/services/__tests__/chat-request-builder.test.ts src/modules/chat/routes/__tests__/research-plan-respond.test.ts`
Expected: PASS

Run: `pnpm --filter backend type-check`
Expected: 除 Task 2/3 尚未处理的调用点外无新增错误；若出现 `visionProxyService` 相关错误，说明容器侧（Task 3）尚未删，允许存在但必须记录在任务报告里。

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/chat/use-cases/chat-stream-use-case.ts packages/backend/src/agent-runtime/chat-request-builder.ts packages/backend/src/modules/chat/agent-web-search-response.ts packages/backend/src/index.ts packages/backend/src/modules/chat/use-cases/__tests__/chat-stream-use-case.test.ts packages/backend/src/modules/chat/services/__tests__/chat-request-builder.test.ts
git commit -m "refactor(chat): 编排层不再调用图片转写代理"
```

---

### Task 2: 联网证据图回退到原始 URL 证据

**Files:**
- Delete: `packages/backend/src/utils/web-image-evidence.ts`、`packages/backend/src/utils/web-image-evidence.test.ts`
- Modify: `packages/backend/src/modules/chat/tool-handlers/url-reader-handler.ts`（13/22-25/40-53/84-108/271-292/342）
- Modify: `packages/backend/src/modules/chat/tool-handlers/web-search-handler.ts`（18/29-32/671-680/1127-1205/1278-1310）
- Modify: `packages/backend/src/modules/chat/tool-handlers/registry.ts`（196-215 两处 handler 构造的第二参）
- Test: `packages/backend/src/modules/chat/tool-handlers/url-reader-handler.test.ts`、`packages/backend/src/services/shares/share-service.test.ts`

**Interfaces:**
- Consumes: Task 1 已删掉 `visionProxy` 传参。
- Produces: `UrlReaderToolHandler` 构造签名变为 `constructor(private config)`（无第二参）；`WebSearchToolHandler` 同理；tool event `details` 中不再有 `assessedImages`，`web_search` 的 `images[]` 不再有 `relevance`。

- [ ] **Step 1: 改写失败用例（红）**

`url-reader-handler.test.ts`：删除对所有 `readRemoteImages` 的 mock 与相关性断言，新增：

```ts
it('keeps raw image urls as evidence instead of assessing relevance', async () => {
  const result = await handler.handle(call, { url: 'https://example.com/a' }, context)
  const payload = JSON.parse(result.message.content as string)
  expect(payload).not.toHaveProperty('assessedImages')
  expect(result.message.content).not.toContain('图片证据（已识图筛选）')
})
```

`share-service.test.ts`：删掉 `assessedImages` fixture 与那条「details 不含 `assessedImages`」的负向断言——**该断言恒真，属假保证（见 ledger R6）**；保留原始 `images` 正向透传断言，并在原处留一行注释说明分享面原样透传历史 tool details。「分享面剥离历史字段」是范围外的新契约，不在本计划内。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter backend test -- src/modules/chat/tool-handlers/url-reader-handler.test.ts src/services/shares/share-service.test.ts`
Expected: FAIL —— 仍产出 `assessedImages` / 「图片证据（已识图筛选）」段。

- [ ] **Step 3: 删实现**

`url-reader-handler.ts`：删 `assessPageImages` 方法、`visionReady` 变量、`assessedForDetails` 与 `imageEvidenceText`、`details.assessedImages`；`formatUrlContentForModel(result, { includeRawImageEvidence: true })`（保留显式传参，保住 Review Focus 第 3 条的空图判断）；删 `visionProxy`/`visionProxyService` 构造参数与 `isVisionProxyReady`/`assessWebImageRelevance` 导入；**保留** `canAttachVisionImages` / `buildVisionFollowupMessages` / `readRemoteImages`（D4）。

`web-search-handler.ts`：删两处 `assessWebImageRelevance` 调用与 `assessedImages`/`assessedForDetails`/`assessedImagesForModel`，`evidenceItem.content` 只拼正文，`evidenceItem.images` 删 `description`/`relevance` 字段，`buildSummaryForModel(query, hits, autoReadEvidence)` 去掉第四参；构造删两个 vision 参数。

`registry.ts`：删 `new WebSearchToolHandler(params.webSearch, { … })` 与 `new UrlReaderToolHandler(params.urlReader, { … })` 的第二参（这两个 handler 构造签名已收敛为单参），保留 `deps` 形参与 `VisionProxyToolHandler` 注册块（Task 4 才删）。

删除 `web-image-evidence.ts` 与其测试文件。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter backend test -- src/modules/chat/tool-handlers/url-reader-handler.test.ts src/modules/chat/tool-handlers/web-search-handler.test.ts src/services/shares/share-service.test.ts`
Expected: PASS

Run: `pnpm --filter backend type-check`
Expected: PASS（`web-image-evidence` 已无引用；若 `buildSummaryForModel` 有第四参调用残留会在此暴露）

- [ ] **Step 5: Commit**

```bash
git add -A packages/backend/src/utils packages/backend/src/modules/chat/tool-handlers packages/backend/src/services/shares
git commit -m "refactor(web): 联网图片证据不再调用转写模型判相关性"
```

---

### Task 3: 设置链路与管理员探针下线

**Files:**
- Delete: `packages/backend/src/services/settings/image-transcription-probe-service.ts`、`packages/backend/src/services/settings/vision-probe-image.ts` 及对应两个测试
- Modify: `packages/backend/src/api/settings.ts`（17-21/26-35/222-226/338-349）
- Modify: `packages/backend/src/services/settings/settings-service.ts`（477-489/573-577/662/697-698/746-747）
- Modify: `packages/backend/src/container/app-container.ts`（67/155/208/320-323）、`packages/backend/src/container/service-keys.ts:66`、`packages/backend/src/index.ts:162`
- Test: `packages/backend/src/services/settings/settings-service.test.ts`

**Interfaces:**
- Consumes: Task 1 已删 `index.ts:130`。
- Produces: `SettingsApiDeps` 无 `visionProxyService` / `imageTranscriptionProbeService`；`AppContainer` 无 `visionProxyService`；路由 `POST /api/settings/image-transcription/probe` 消失（404）。**shared 的 `SystemSettings` 字段与前端 patch 分支留到 Task 7 一并删**（见 Ruling R2：shared 字段的唯一消费方是前端，提前删会让前端 `use-chat-composer` 在 Task 7 之前一直类型报错）。

- [ ] **Step 1: 改写失败用例（红）**

`settings-service.test.ts`：删 3 段 `image_transcription_reasoning_*` 断言，新增：

```ts
it('ignores stale image transcription patches from old clients', async () => {
  const { service, prisma } = buildService()
  await service.updateSystemSettings({ image_transcription_enabled: true, image_transcription_model_id: 'x' })
  expect(prisma.systemSetting.upsert).not.toHaveBeenCalledWith(
    expect.objectContaining({ where: { key: 'image_transcription_enabled' } }),
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter backend test -- src/services/settings/settings-service.test.ts`
Expected: FAIL —— 旧键仍被写入。

- [ ] **Step 3: 删实现**

settings-service：删格式化块、全员可见输出块、`assignIfNumber('image_transcription_connection_id')`、boolFields 两项、stringFields 两项。shared 的两个文件本任务**不动**（R2）。

api/settings.ts：删两个 import、deps 两字段与默认构造、zod 5 字段、`/image-transcription/probe` 路由。

container：删 import、deps 字段、readonly 字段、注册块；service-keys 删 key；index.ts 删 `createSettingsApi` 的 `visionProxyService`。

删除 probe 服务与探针图两个文件及测试。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter backend test -- src/services/settings/settings-service.test.ts src/__tests__/retired-provider-contracts.test.ts`
Expected: PASS（`retired-provider-contracts` 里 `image_transcription_ollama_think` 仍被忽略，属预期）

Run: `pnpm --filter backend type-check`
Expected: PASS（`AppContainer` 已无残留引用）

- [ ] **Step 5: Commit**

```bash
git add -A packages/backend/src/services/settings packages/backend/src/api/settings.ts packages/backend/src/container packages/backend/src/index.ts
git commit -m "refactor(settings): 移除图片转写代理设置项与管理员探针"
```

---

### Task 4: 删除核心服务与 `analyze_visual_media` 工具

**Files:**
- Delete: `packages/backend/src/services/vision/vision-proxy-service.ts`、`packages/backend/src/services/vision/vision-image-prepare.ts`、`packages/backend/src/modules/chat/services/vision-proxy-service.ts`、`packages/backend/src/modules/chat/services/vision-image-prepare.ts`、`packages/backend/src/modules/chat/tool-handlers/vision-proxy-handler.ts` 及 3 个测试
- Modify: `packages/backend/src/modules/chat/tool-handlers/registry.ts`（28/32/196-215/247-250）
- Modify: `packages/backend/src/agent-runtime/agent-tool-config.ts`（14/458-464）
- Modify: `packages/backend/src/agent-runtime/tool-handler-types.ts`（6/150）
- Modify: `packages/backend/src/modules/skills/skill-registry.ts`（11/537/543）
- Test: `packages/backend/src/modules/chat/__tests__/agent-tool-config.test.ts`

**Interfaces:**
- Consumes: Task 1/2/3 已无任何调用方。
- Produces: `createToolHandlerRegistry(params)` 单参；`ToolHandlerFactoryParams` 无 `visionProxy?`；`ToolCallContext` 无 `visionProxy?`；`agent-tool-config` 不再导出 `AgentVisionProxyConfig` / `buildAgentVisionProxyConfig`。

- [ ] **Step 1: 改写失败用例（红）**

`agent-tool-config.test.ts`：删 `buildAgentVisionProxyConfig` 用例，新增：

```ts
it('no longer exports vision proxy config builder', async () => {
  const mod = await import('../../../../agent-runtime/agent-tool-config')
  expect(mod.buildAgentVisionProxyConfig).toBeUndefined()
})
```
（测试跑在 ts-jest ESM 下，没有 `require`；从 `src/modules/chat/__tests__/` 出发是四级相对路径。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter backend test -- src/modules/chat/__tests__/agent-tool-config.test.ts`
Expected: FAIL —— 导出仍存在。

- [ ] **Step 3: 删实现并删除 5 个源文件**

registry：删 `VisionProxyToolHandler` import、`VisionProxyService` 类型 import、deps 第二参、两个 handler 的 `visionProxy`/`visionProxyService` 传参、`if (params.visionProxy?.enabled)` 注册块。

agent-tool-config：删 import 与两个导出。

tool-handler-types：删 `VisionProxyConfig` import 与 `ToolHandlerFactoryParams.visionProxy`（该字段只存在于工厂参数，`ToolCallContext` 从未有过它）。

skill-registry：删 import、`visionProxyService?` 字段、`createToolHandlerRegistry` 第二参。

删除 5 个源文件 + 3 个测试文件。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter backend test -- src/modules/chat/__tests__/agent-tool-config.test.ts src/modules/chat/tool-handlers`
Expected: PASS

Run: `pnpm --filter backend type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A packages/backend/src
git commit -m "refactor(chat): 删除图片转写服务与 analyze_visual_media 工具"
```

---

### Task 5: 删除消息图片描述字段

**Files:**
- Modify: `packages/backend/prisma/schema.prisma:124`
- Create: `packages/backend/prisma/migrations/20261113120000_remove_image_transcription/migration.sql`
- Modify: `packages/backend/src/modules/chat/services/message-query-service.ts`（48/101/143/496-508/539-542）
- Test: `packages/backend/src/modules/chat/services/message-query-service.test.ts`

**Interfaces:**
- Consumes: Task 1 已删掉唯一写入方。
- Produces: API 消息对象无 `imageDescriptions`；`RawMessage` select 不含 `imageDescriptionsJson`。

- [ ] **Step 1: 改写失败用例（红）**

`message-query-service.test.ts` 把 `normalizes imageDescriptionsJson into imageDescriptions` 改为：

```ts
it('does not expose imageDescriptions on messages', async () => {
  const result = await service.listMessages(/* 现有 fixture */)
  const message = result.messages[0]
  expect(message).not.toHaveProperty('imageDescriptions')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter backend test -- src/modules/chat/services/message-query-service.test.ts`
Expected: FAIL —— 仍返回该字段。

- [ ] **Step 3: 删实现 + 建迁移**

message-query-service 删 select 字段、`RawMessage` 可选字段、返回类型字段、解构与解析块。

`schema.prisma` 删 `imageDescriptionsJson` 行。迁移文件内容：

```sql
ALTER TABLE "messages" DROP COLUMN "image_descriptions_json";

DELETE FROM "system_settings" WHERE "key" GLOB 'image_transcription_*';
```

- [ ] **Step 4: 生成客户端并跑测试**

Run: `pnpm --filter backend exec prisma generate`
Expected: 成功，无 schema 校验错误

Run: `pnpm --filter backend test -- src/modules/chat/services/message-query-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma packages/backend/src/modules/chat/services/message-query-service.ts packages/backend/src/modules/chat/services/message-query-service.test.ts
git commit -m "refactor(db): 删除 messages.image_descriptions_json 与转写设置键"
```

---

### Task 6: 前端设置页下线

**Files:**
- Delete: `packages/frontend/src/components/settings/pages/model-connections/ImageTranscriptionCard.tsx`、`.../image-transcription-probe-result.tsx`、`.../__tests__/ImageTranscriptionCard.test.tsx`
- Modify: `packages/frontend/src/components/settings/system-settings-registry.tsx`（99-102/135-139/231/276）
- Modify: `packages/frontend/src/api/settings.ts`（194-208/347-377）

**Interfaces:**
- Consumes: Task 3 已删掉后端字段与探针端点。
- Produces: `systemSettingsTree` 10 个叶子；`leafComponentMap` 无 `image-transcription`；`api/settings` 无 `probeImageTranscription`。

- [ ] **Step 1: 补深链回退用例（红）**

沿用既有 `packages/frontend/src/components/settings/__tests__/system-settings-registry.test.tsx`（**不新建文件**），在已退役叶子的断言旁边加：

```ts
it('retires the image-transcription leaf without breaking old deep links', () => {
  expect(renderSystemLeaf('image-transcription')).toBeNull()
  expect(systemSettingsCards.some((c) => c.leafKey === 'image-transcription')).toBe(false)
})
```

再补一条叶子总数断言（10）。

说明：`renderSystemLeaf` 对未知 key **本来就返回 null**，`system-settings.tsx:40/:47` 与 `settings-dialog.tsx` 都以 `!== null` 判定后才采用，旧书签/旧深链会自然回落到默认叶子。**不要**新造 `resolveLeafComponent`——那是重复既有 API。（R8）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter frontend exec vitest run src/components/settings/__tests__/system-settings-registry.test.ts`
Expected: FAIL —— 叶子仍是 11 个，未知 key 返回 `undefined`。

- [ ] **Step 3: 删实现**

registry 删动态导入、导航子项、卡片注册、`leafComponentMap` 里的 `image-transcription`；注释「11 leaves in total」改 10。不新增任何 API。

`api/settings.ts` 删 5 个 patch 分支、3 个 probe 类型、`IMAGE_TRANSCRIPTION_PROBE_TIMEOUT_MS` 与 `probeImageTranscription`。

删除 2 个组件与 1 个测试。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter frontend exec vitest run src/components/settings`
Expected: PASS

Run: `pnpm --filter frontend type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A packages/frontend/src/components/settings packages/frontend/src/api/settings.ts
git commit -m "refactor(settings-ui): 下线图片转写设置页"
```

---

### Task 7: 前端聊天加图门禁收敛

**Files:**
- Modify: `packages/frontend/src/hooks/use-chat-composer.ts`（210-218/233-235/309/338/426-427/495-498）
- Modify: `packages/frontend/src/hooks/use-send-command.ts`（17-19/61-62/121/193-194）
- Modify: `packages/frontend/src/hooks/use-drag-drop.ts`（14-22/44/71）
- Modify: `packages/frontend/src/features/chat/composer/classify-files.ts`（7-32）
- Modify: `packages/frontend/src/features/chat/composer/use-image-attachments.ts`（6-14/27/85-93/156-175/230）
- Modify: `packages/frontend/src/components/chat/composer-attachment-list.tsx`（20-49）
- Modify: `packages/frontend/src/components/chat/{desktop-composer,mobile-composer,chat-composer-panel}.tsx`
- Modify: `packages/frontend/src/hooks/use-chat-interface-viewmodel.ts`（38-39/211-212）
- Modify: `packages/shared/src/settings-codec.ts`（114-119/517-530/621-626）
- Modify: `packages/shared/src/settings-contract.ts`（82-86）
- Test: `use-send-command.test.ts`、`use-image-attachments.test.tsx`、`chat-composer-panel.test.tsx`、`composer-attachment-list.test.tsx`

**Interfaces:**
- Consumes: Task 6 已删 `SystemSettings.imageTranscription*`。
- Produces: `canAttachImages` 从全链路删除，门禁唯一事实源是 `isVisionEnabled`；`useImageAttachments` 只接受 `isVisionEnabled`；`ComposerAttachmentList` 无 `visionProxyHint`；`SystemSettings` 不再有 5 个 `imageTranscription*` 字段。

- [ ] **Step 1: 改写失败用例（红）**

`use-image-attachments.test.tsx`：删「转写代理模式下提示性 toast」两条，新增：

```tsx
it('rejects images when the model does not support vision', async () => {
  const { result } = renderHook(() => useImageAttachments({ isVisionEnabled: false, limits, toast }))
  act(() => result.current.pickImages([pngFile]))
  expect(result.current.selectedImages).toEqual([])
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
})
```

`composer-attachment-list.test.tsx` 删「图片将由 X 转写」断言，新增断言该文案在任何 props 下都不出现。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter frontend exec vitest run src/features/chat/composer/__tests__/use-image-attachments.test.tsx src/components/chat/__tests__/composer-attachment-list.test.tsx`
Expected: FAIL

- [ ] **Step 3: 删实现**

按 Files 逐个删 `visionProxyEnabled` / `visionProxyModelId` / `visionProxyReady` / `visionProxyHint` / `canAttachImages` 参数与分支；`use-chat-composer` 的 `useImageAttachments` 只传 `isVisionEnabled`；`classifyFiles(files, { isVisionEnabled })`；`use-send-command` 的发送条件回到 `isVisionEnabled && prevSelectedImages.length`。

shared：`settings-codec.ts` 删类型 5 字段、反序列化 5 行、返回对象 5 行；`settings-contract.ts` 删 5 条映射。（`frontend/src/api/settings.ts` 的 5 个 patch 分支归 Task 6，本任务不碰该文件。）

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter @aichat/shared build && pnpm --filter frontend exec vitest run src/features/chat src/components/chat src/hooks`
Expected: PASS

Run: `pnpm --filter frontend type-check`
Expected: PASS（多余 props 会在此暴露）

- [ ] **Step 5: Commit**

```bash
git add -A packages/frontend/src/hooks packages/frontend/src/features/chat packages/frontend/src/components/chat packages/shared/src
git commit -m "refactor(chat-ui): 图片门禁收敛回模型 vision 能力"
```

---

### Task 8: 前端消息层删除转写痕迹

**Files:**
- Modify: `packages/frontend/src/types/chat.ts`（61-62/92）
- Modify: `packages/frontend/src/components/message-bubble/index.tsx`（325-330）
- Modify: `packages/frontend/src/components/message-bubble/message-header.tsx`（30/47/78-80）
- Modify: `packages/frontend/src/features/chat/store/utils/index.ts:182`
- Modify: `packages/frontend/src/features/chat/store/slices/stream-message.ts:91`
- Test: `packages/frontend/src/components/message-bubble/__tests__/message-header.test.tsx`

**Interfaces:**
- Consumes: Task 5 已删 API 字段。
- Produces: `ChatMessage` 无 `imageDescriptions`；`MessageHeader` 无 `imageDescriptionNote`。

- [ ] **Step 1: 改写失败用例（红）**

`message-header.test.tsx`：把 `renders transcription note…` 换成：

```tsx
it('renders no transcription note', () => {
  render(<MessageHeader isUser timestamp="now" />)
  expect(screen.queryByText(/转写/)).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter frontend exec vitest run src/components/message-bubble/__tests__/message-header.test.tsx`
Expected: FAIL（prop 未删时用例传参会报类型错，删一半也会失败）

- [ ] **Step 3: 删实现**

删 `imageDescriptions` 类型与两处 store 映射、message-bubble 的 prop 传入、message-header 的 prop 与渲染块。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter frontend exec vitest run src/components/message-bubble src/features/chat/store`
Expected: PASS

Run: `pnpm --filter frontend type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A packages/frontend/src/types packages/frontend/src/components/message-bubble packages/frontend/src/features/chat/store
git commit -m "refactor(chat-ui): 消息层不再携带图片转写描述"
```

---

### Task 9: 文档、环境变量与全量验收

**Files:**
- Modify: `CONTEXT.md`（63/116/119-121）、`README.md`（13/143）、`CHANGELOG.md`（未发布段）、`.env.example`（196-202）、`packages/frontend/src/features/settings/README.md`
- Create: `docs/plans/2026-11-13-remove-image-transcription.md`

**Interfaces:**
- Consumes: 前 8 个任务的最终状态。
- Produces: 仓库内除历史 CHANGELOG/plan 外，无 `image_transcription` / `imageTranscription` / `visionProxy` / `analyze_visual_media` 命中。

- [ ] **Step 1: 写文档**

CONTEXT.md：删 `Vision Transcription Proxy`、`Image Transcription`、`Visual Analysis Tool` 三条术语；`Read URL` 条目去掉「图片转写代理就绪时做识图相关性判定」；设置页「共 11 个」改 10 并删「图片转写」。

README.md：删特性条目与目录里的该术语链接。

.env.example：删 5 个 `IMAGE_TRANSCRIPTION_*` 变量及其注释块。

settings/README.md：导航说明去掉「图片转写」，叶子计数改 10。

CHANGELOG 未发布段新增一条 BREAKING：说明删除范围、行为变化（图片一律直接发主模型；联网图片证据回到原始 URL 列表）、迁移命令与「无向后兼容」。

`docs/plans/2026-11-13-remove-image-transcription.md`：记录删除动机、范围、决策 D1-D5、迁移与影响面，体例对齐 `docs/plans/2026-09-06-remove-retired-providers.md`。

- [ ] **Step 2: 残留检查**

Run:
```bash
grep -rnE "visionProxy|imageTranscription|image_transcription|analyze_visual_media|imageDescriptions" packages --include=*.ts --include=*.tsx --include=*.prisma
```
Expected: 无输出（`packages/backend/logs`、`packages/*/output`、`.next` 已在忽略范围内；若命中历史日志文件属预期，用 `--include=*.ts` 已排除）

- [ ] **Step 3: 全量验证**

依次执行，全部必须通过：
```bash
pnpm --filter @aichat/shared build
pnpm --filter backend type-check
pnpm --filter frontend type-check
pnpm --filter backend test
pnpm --filter frontend exec vitest run
node scripts/check-architecture.mjs
pnpm lint:lines
```
Expected: 全绿。任何失败都必须修到通过，或在该任务报告里给出「与本次改动无关」的证据（失败用例名 + 改动前同样失败的复现），不得以「先跳过」收尾。

- [ ] **Step 4: 迁移演练**

Run: `pnpm --filter backend exec prisma migrate deploy`
Expected: 迁移 `20261113120000_remove_image_transcription` 应用成功；`SELECT name FROM pragma_table_info('messages')` 不再含 `image_descriptions_json`。

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md README.md CHANGELOG.md .env.example packages/frontend/src/features/settings/README.md docs/plans/2026-11-13-remove-image-transcription.md
git commit -m "docs: 移除图片转写的文档与环境变量"
```

---

## 自检结论

- 需求覆盖：8 个后端源文件、2 个前端组件、5 个设置键、1 个 DB 列、1 个内置工具、1 条联网证据图链路、6 处文档全部有对应任务。
- 类型一致性：`visionProxy` 系列名字在 Task 1-4 逐步收口，Task 6-8 只依赖已收敛的 `SystemSettings` 与 `ChatMessage`。
- Review Focus 5 条均已挂到具体任务（第 1 条→Task 5/8，第 2 条→Task 7，第 3 条→Task 2，第 4 条→Task 6，第 5 条→Task 3）。
