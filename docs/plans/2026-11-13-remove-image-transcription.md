# 移除图片转写（Vision Transcription Proxy）实施计划

**目标：** 把「图片转写代理」从代码、类型、配置、数据库、前端界面与文档中彻底移除，让仓库回到「图片一律直接发给主模型」的单一链路。

**已确认边界：** 删除对象是「主模型不支持 vision 时把图片转写成文字描述」这一层能力，不是图片输入本身——图片上传、Rich Payload、AI 生图、Battle 题目配图、分享页图片，以及 `read_url` 把网页图直接附给主模型（vision followup）全部保留。历史增量不改写：被删的 5 个设置键、`messages.image_descriptions_json` 列与 `IMAGE_TRANSCRIPTION_*` 环境变量一律真删，不保留 deprecated 别名或「暂时保留」分支。历史 plan 文档（`docs/superpowers/plans/2026-08-04-vision-transcription-proxy.md`、`docs/plans/2026-08-17-image-transcription-probe*.md`）作为开发历史不动。

**技术栈：** TypeScript / Hono / Prisma(SQLite) / Next.js 15 + React / jest（后端）/ vitest（前端）/ pnpm workspace（`packages/shared` 是前后端共享契约源）。

## 决策

- **D1 联网证据图回到原始 URL**：`read_url` / `web_search` 的图片相关性判定整条删除，两处回退到「未配置转写代理」时的既有分支——`includeRawImageEvidence: true` 输出原始图片 URL 列表，不再下载图片、不再产出 `relevance` / `confidence` / `description` 字段。保留 `utils/remote-image-reader.ts`（`export-pdf-handler.ts` 与 `read_url` 的 vision followup 仍在用）。
- **D2 历史数据**：迁移 `20261113120000_remove_image_transcription` 执行 `DROP COLUMN messages.image_descriptions_json` 与 `DELETE FROM system_settings WHERE key GLOB 'image_transcription_*'`。用 `GLOB` 而非 `LIKE`：SQLite 的 `LIKE` 里 `_` 是单字符通配且不区分 ASCII 大小写，会误伤 `image-transcription_*` 与 `IMAGE_TRANSCRIPTION_*`。历史消息丢失「图片描述由 X 转写」文本，图片附件本身不动。
- **D3 `mainModelVision` 参数一并删除**：它唯一的存在理由是配合转写（决定「无 vision 主模型不吃图」）。删除后图片一律透传，等同转写功能上线前行为。
- **D4 `resolveModelCapabilitiesForSession` 保留**：`agent-web-search-response.ts` 仍用它给工具上下文注入 `modelCapabilities`（`read_url` 直接把网页图附给主模型的路径），与转写无关。
- **D5 前端门禁唯一事实源是 `isVisionEnabled`**：`canAttachImages` 与 `visionProxyHint` 从 `useImageAttachments` / `ClassifyFilesOptions` / `ComposerAttachmentList` 全链路删除；无 vision 模型加图仍在选择、粘贴、发送三个入口被阻止，并共用同一条提示文案。

## 实施与验证

1. 编排层与请求构建：先写「不再调用转写服务」的入参契约断言，再断开 `chat-stream-use-case`、`chat-request-builder` 对 `visionProxyService` 的调用与 `mainModelVision` 传参。
2. 联网证据图：`url-reader-handler` / `web-search-handler` 删两处相关性判定与 `assessedImages`，保留「有图才输出图片证据段」的判断（纯文本页不出现空段）；删除 `web-image-evidence.ts`。
3. 设置链路：`settings-service` / `api/settings.ts` / 容器接线删 5 个键、探针服务与 `POST /api/settings/image-transcription/probe` 路由；旧客户端写旧键被忽略且返回 200。
4. 核心服务与工具：删除 `vision-proxy-service`、`vision-image-prepare`（含 `modules/chat` 下的两个 shim）、`vision-proxy-handler` 与内置工具 `analyze_visual_media`，`createToolHandlerRegistry` 收敛为单参。
5. 数据：新增迁移删列删键，并补迁移覆盖测试（含 `GLOB` 谓词不误伤同形键的边界）。
6. 前端：下线设置页「图片转写」叶子与转写卡片/探针组件，聊天加图门禁收敛回模型 vision 能力，消息层不再携带 `imageDescriptions`。
7. 契约收尾与文档：删 `RichMessageImagePart.confidence` / `RichMessageEvidenceConfidence` 与 `ToolEventDetails.images[].title`（无生产方），同步 CONTEXT / README / CHANGELOG / `.env.example` / settings README，并跑全量验收。

## 数据替换说明

这是直接移除能力的破坏性变更，无向后兼容层。升级必须先执行 `pnpm --filter backend prisma migrate deploy` 应用 `20261113120000_remove_image_transcription`：`messages.image_descriptions_json` 被 DROP（历史消息的转写描述文本随之丢失，图片附件本身不动），`system_settings` 里 5 个 `image_transcription_*` 键被 DELETE；随后执行 `pnpm --filter backend prisma generate`。`.env` 里的 5 个 `IMAGE_TRANSCRIPTION_*` 变量不再读取，留着不报错，但应删除以免被误判为仍生效。旧前端不再被照顾：未知设置键被忽略并返回 200，localStorage 里残留的 `image-transcription` 叶子落回默认叶子，显式渲染该 key 时输出「暂无可用的系统设置模块」占位。需要「图片理解」的服务改为直接使用支持 vision 的模型。

## 影响面

- **后端**：本支路删除 17 个文件，其中 14 个属后端（转写服务、两个模块 shim、`vision-proxy-handler`、探针服务与探针图、`web-image-evidence` 及各自测试）；`ToolHandlerFactoryParams` / `ToolCallContext` 去掉 `visionProxy?`，`agent-tool-config` 不再导出 `AgentVisionProxyConfig` / `buildAgentVisionProxyConfig`。
- **共享契约**：`SystemSettings` 去掉 5 个 `imageTranscription*` 字段与对应 patch 分支；`RichMessageImagePart` 去掉 `confidence` 字段，`RichMessageEvidenceConfidence` 随之删除。
- **前端**：删除设置页「图片转写」叶子、`ImageTranscriptionCard` 与探针结果组件（含测试）；`ToolEventDetails.images[].title` 删除（无生产方）。
- **配置与文档**：`.env.example` 删 8 行（注释块 + 5 个变量 + 尾随空行）；CONTEXT / README / settings README 同步术语与叶子计数（11 → 10）。
- **护栏（刻意保留）**：`use-send-command.test.ts`、`chat-composer-panel.test.tsx`、`composer-attachment-list.test.tsx`、`use-image-attachments.test.tsx`、`classify-files.test.ts` 共 5 条「退役能力被忽略」负例，用于防止 `visionProxy*` / `canAttachImages` / 「图片将自动转写」被误接回链路。

## 验证记录

- 后端全量：`pnpm --filter backend test` → 151 个套件 / 906 个用例，905 通过、1 失败（`skill-anthropic-compat`，退出码 1）。失败原因是 `NODE_USE_ENV_PROXY=1` 让子进程 stderr 带上 Node 的 `UNDICI-EHPA` 警告，而该用例断言 `expect(run.stderr).toBe('')`；本支路未改动该文件，CHANGELOG 已记录升级前同样失败，属既有失败。
- 前端全量：`pnpm --filter frontend exec vitest run` → 117 个测试文件 / 683 个用例全部通过（55.00s，退出码 0）。
- 类型与构建：`pnpm --filter @aichat/shared build`、`pnpm --filter frontend type-check`、`pnpm --filter backend type-check` 均退出码 0。
- 架构检查：`node scripts/check-architecture.mjs` → `[architecture] OK: 4 package sources, no cycles, api layer db-free`。
- 行数门禁：`pnpm lint:lines` 在 merge-base（`d7697ba4`）与本支路末端同为 59 个文件超 300 行，无新增、无移除；本支路改过的 10 个超限文件中 9 个净减少（合计 −69 行），`hooks/__tests__/use-send-command.test.ts` 由 320 增至 336（+16），因其在 Task 7 新增了「退役 `visionProxyEnabled` 被忽略」护栏用例，且该文件在 merge-base 时已超限。
- 残留检查：生产代码 `grep -rnE "visionProxy|imageTranscription|image_transcription|analyze_visual_media|imageDescriptions"` 零输出；测试内退役名字命中 5 个文件共 8 行（5 条护栏用例），均为刻意保留。
- 迁移演练（先备份 `app.db.bak-before-drop-image-descriptions`）：`pnpm --filter backend exec prisma migrate deploy` 以 58 个迁移应用 `20261113000000_user_context_enabled` 与 `20261113120000_remove_image_transcription`（退出码 0）；`pragma_table_info('messages')` 不再含 `image_descriptions_json`，`system_settings` 中 `image_transcription_*` 为 0 行（`GLOB` 与 `LIKE` 两种探针都为 0），`PRAGMA integrity_check` = ok，28 条历史消息保留。
