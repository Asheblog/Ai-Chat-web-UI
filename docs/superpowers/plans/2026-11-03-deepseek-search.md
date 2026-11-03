# DeepSeek 联网搜索实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 DeepSeek 作为第五个通用搜索引擎，提供可选 Fetch 回退，复用现有聊天、深度研究与 Battle 工具链路。

**Architecture:** 独立 DeepSeek HTTP 模块统一请求校验、错误与结果转换；共享引擎契约收敛允许列表。新凭据进入既有 Secret Vault，运行时异步解析后交给现有纯配置构建器；本地读页失败且显式开启时才调用 Fetch。

**Tech Stack:** TypeScript、Hono、Prisma/SQLite、Next.js/React、Jest、Vitest。

**Spec:** 用户已审阅本会话中的五点设计，并于 2026-11-03 指示实施、调用子智能体以及限流后重试。官方协议依据 `https://api-docs.deepseek.com/zh-cn/guides/search/`、`/zh-cn/api/search`、`/zh-cn/api/fetch`。

## Global Constraints

- 中文沟通；新增或修改文件为 UTF-8 无 BOM；兼容 Windows/pwsh 7 与 Linux 容器。
- 无新增供应商 SDK、无数据库结构迁移、无迁移直接扩展现有功能；不调用收费生产 API。2026-11-04 用户追加授权：完成后合并主分支并推送仓库，要求构建通过。
- 新增引擎默认关闭；Fetch 默认关闭；默认并行引擎数仍为 3，允许列表/上限扩展为 5。
- DeepSeek 密钥独立配置，不从聊天模型连接继承；新增密钥加密保存，API 不回显。
- Search: POST /v1/tools/search，Bearer；query 为 1–128 Unicode 字符，count 映射现有 1–10 限制；按需 need_content，summary/snippet 与正文分开处理。
- Fetch: POST /v1/tools/fetch，Bearer；本地读取失败后才触发；校验公开 HTTP(S) URL，保留错误、尝试记录和来源。
- 项目现有配色、字号、间距、FeatureCard、按钮与控件优先；UI 使用 ui-ux-pro-max。
- TDD；最小充分验证；复用子智能体已通过证据；不机械重跑。

## Review Focus

- Unicode 查询超长不能截断成含义不同的搜索；空结果、缺失正文、非法响应与上游错误必须可区分。
- DeepSeek 仅提供当前文档明确的网页检索能力；图片/其他专属 scope 应跳过或明确失败，site_icon 不能变成证据图。
- 并行搜索失败隔离、域名约束、取消/超时、正文预算不能被新增适配器绕过。
- Key 省略保持、显式清除、环境变量回退、加密失败、hasKey 与运行时真实凭据保持一致。
- 正文复用只作用于可用证据，避免重复抓取；Fetch 不抢占已有图片/文档读取，不在未开启时产生付费调用。

## Task 1: 共享契约、凭据与运行时装配（主智能体）

Files: packages/shared/src/web-search-contract.ts、settings-contract.ts、settings-codec.ts、index.ts；backend agent-tool-config、settings API/service、container、chat/battle 装配；对应测试。

Interfaces:
- 共享 `WEB_SEARCH_ENGINE_IDS`、`WebSearchEngine`、`isWebSearchEngine(value)`，含 deepseek。
- SystemSettings 新字段 `webSearchApiKeyDeepseek?: string`（只写）、`webSearchHasApiKeyDeepseek?: boolean`、`webSearchDeepseekFetchEnable?: boolean`。
- 存储键 `web_search_api_key_deepseek`（请求/运行时注入，禁止明文落库）、`web_search_has_api_key_deepseek`、`web_search_deepseek_fetch_enable`、`web_search_deepseek_secret_id`（内部引用）。
- `AgentWebSearchConfig.deepseekFetchEnabled?: boolean`；`AgentUrlReaderConfig.enableDeepseekFallback?: boolean`、`deepseekApiKey?: string`。
- 环境变量 WEB_SEARCH_API_KEY_DEEPSEEK、WEB_SEARCH_DEEPSEEK_FETCH_ENABLE；运行时解密集中装配，纯配置 builder 保持同步。

- [x] 写凭据保存/读回/清除/解密和 DeepSeek 配置失败测试；定向运行观察失败。
- [x] 实现共享引擎契约和设置字段、加密写入与运行时解析，装配聊天和 Battle。
- [x] 运行相关设置、工具配置与装配测试并记录证据。

## Task 2: Search、正文复用与 Fetch 回退（子智能体 A）

Files: backend utils/deepseek-tools.ts（新模块）、utils/web-search.ts、utils/url-reader.ts、modules/chat/tool-handlers/web-search-handler.ts、url-reader-handler.ts 及对应测试；不写 Task 1/3 的文件。

Interfaces:
- `runWebSearch`/`runWebSearchParallel` 对 deepseek 返回既有 WebSearchHit；传入 apiKey、limit、scope、domains、includeRawContent、signal。
- `readUrlContent` options 新增 `enableDeepseekFallback?: boolean`、`deepseekApiKey?: string`；handler 使用 Task 1 提供的同名配置。
- WebSearchHandler 的自动读页使用 `config.deepseekFetchEnabled` 与 `config.apiKeys.deepseek`；按现有正文预算复用 Search 的有效 content。
- 固定官方 Search/Fetch 地址，不把其它引擎的全局 endpoint 覆盖盲目发送给 DeepSeek；不记录 Key 或未经清理的上游错误体。

- [x] 写请求契约、Unicode/空响应/错误/域名过滤、正文复用、Fetch 关闭/成功/失败/私网拒绝测试，先验证失败。
- [x] 实现独立 HTTP 模块并接入现有搜索、读页和工具事件，更新引擎过滤与并行上限。
- [x] 定向运行 Search、URL reader、handler 回归；回报命令、通过数量及未决项。

## Task 3: 管理页（子智能体 B）

Files: frontend components/settings/pages/search-knowledge/web-search-card.tsx、相关设置卡注册/搜索元数据（如必要）、components/settings/__tests__/search-knowledge-page.test.tsx；不写 shared/backend。

Interfaces: 消费 Task 1 的三个 SystemSettings 字段；空 Key draft 不提交（保持原值），清除使用显式空字符串；Fetch 默认 false。共享引擎契约从 @aichat/shared/web-search-contract 或根入口导入。

- [x] 使用 ui-ux-pro-max，读取至少三个相关页面/公共组件及布局样式；写配置保存、Key 清除/省略和 Fetch 默认关闭失败测试。
- [x] 实现 DeepSeek 选择排序、独立 Key 和 Fetch 开关，显示付费与能力提示，沿用现有 FeatureCard/更多参数结构。
- [x] 运行设置页定向 Vitest，给出结果；页面截图由主智能体集成时完成。

## Task 4: 集成、文档与审查（主智能体）

- [x] 更新 CONTEXT.md、README/.env.example，说明凭据、正文复用、付费 Fetch 与无数据库迁移。
- [x] 覆盖改动模块测试与 backend/frontend type-check；共享契约变化按证据决定是否需要扩大测试。
- [x] 启动本地页面并截图，检查中文长文本、默认/加载态、布局与可访问名称。
- [x] 基线 `git merge-base origin/main HEAD`；审查包含工作区差异，完成 Standards + Spec 双轴审查并裁决全部未决项。
- [x] 报告交付、实际验证及剩余限制。
- 集成方式：按追加授权将通过构建的版本快进合并 main 并推送 origin，实际提交与推送结果以交付时 Git 输出为准。

## Progress

- 2026-11-03：已创建 codex/deepseek-search 分支；沿用用户授权的现有工作区，避免为已可隔离的文件写集额外复制依赖。
- 2026-11-04：共享 build 通过；配置、凭据、设置服务、工具配置、Skill override、聊天与 Battle 定向首批 7 suite / 38 项通过；补容器装配 2 suite / 8 项通过。
- 2026-11-04：工具链 6 suite / 70 项通过；循环类型依赖拆分后 18 项通过；IPv6 URL 校验回归新增后，host-safety / DeepSeek / URL reader 共 3 suite / 79 项通过。后端类型及架构检查通过。
- 2026-11-04：凭据故障隔离测试先红后绿（配置与凭据共 10 项），损坏/越权引用重新配置回归先红后绿（凭据最终 9 项）；HTTP 设置边界 4 项通过。前端 API 3 项、设置页最终 13 项通过；相关卡注册表与 FeatureCard 回归已通过；前端类型检查通过。
- 2026-11-04：Playwright 模拟管理接口，查看桌面、390px 窄屏、更多参数与加载态截图；未写入真实配置。窄屏文档宽度为 390px。截图位于 output/playwright/deepseek-settings-*.png（本地产物）。
- 2026-11-04：Docker CLI 不可用，无法运行 compose config / 容器构建；以 YAML 解析与六项变量透传静态检查替代，三份 Compose 均通过。未调用真实收费 API，未运行全量测试。
- Ruling: 损坏的搜索凭据仅停用 DeepSeek，禁止环境变量绕过，但允许管理员重新配置或清除引用且不触碰外部凭据 — 避免阻断普通聊天并提供恢复路径 — 错判代价是该引擎暂不可用，管理页显示未配置且服务日志提示。
- 2026-11-04：双轴审查报告已写盘；Standards 无硬规则违规，Spec 唯一剩余项是本地读页超时/取消后继续回退，已交原负责人按单一总 deadline 修复。非 2xx MIME 与 JSON body 取消/超时边界已由审查者核对排除。
- 2026-11-04：默认与 Skill 预设语言路由补入 DeepSeek，中文首批可选中该引擎；新增路由/预设回归先红（3 失败/17 通过）后绿（2 suite /20 tests）。复用同一 autoRead 谓词，避免 Search 正文请求与读页启用条件漂移。
- Ruling: 管理员排序筛选并行候选，语言路由在候选内选择首批来源，显式 Skill 语言路由可覆盖默认排序 — 保留项目现有语言路由行为并补齐第五引擎，而不改变所有旧引擎的排序含义 — 错判代价是管理员顺序不保证首批来源，已在 CONTEXT 说明。
- Ruling: 保留专用搜索凭据模块的事务写入和各边界选项名称，将通用 Vault 事务接口与工具卡来源中文映射记为维护建议 — 不为启发式审查建议扩大安全敏感接口及 UI 范围 — 错判代价是未来新增凭据能力时仍需统一仓储。
- 2026-11-04：读页整体 deadline 修复新增 14 项红绿回归，reader 最终 46/46；Spec 已复核通过，无实质未决项。
- 2026-11-04：合入前扩大至 CI 范围验证：backend 141 suite /841 tests、frontend 83 files /484 tests、mobile 3 files /8 tests 全部通过；backend/frontend/mobile 类型检查通过。
- 2026-11-04：shared build 已通过；backend 生产 build 在 Git Bash 脚本 shell 下通过，frontend 完整生产 build（含 standalone）在仅本地构建进程使用 junction 适配后通过。首次 Windows 默认构建分别因 cp 不在 cmd PATH、Next 14 standalone symlink 无权限失败；未改构建源码或系统权限。Docker CLI 缺失，容器镜像构建仍需仓库 CI 验证。
