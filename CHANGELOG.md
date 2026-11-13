# 更新日志

## 未发布

- BREAKING: 移除「图片转写代理（Vision Transcription Proxy）」——主模型不支持识图时不再把用户图片转写成文字描述。删除范围：后端转写服务与模块 shim（`vision-proxy-service`、`vision-image-prepare`）、实现内置工具 `analyze_visual_media` 的 `vision-proxy-handler`、管理员探针（`image-transcription-probe-service`、`vision-probe-image`）与路由 `POST /api/settings/image-transcription/probe`、网页图相关性判定（`web-image-evidence.ts` 及 tool details 的 `assessedImages` / `relevance` 字段）、5 个系统设置键 `image_transcription_*`（enabled / connection_id / model_id / reasoning_enabled / reasoning_effort）、`messages.image_descriptions_json` 列、Shared 契约 `RichMessageImagePart.confidence` 与 `RichMessageEvidenceConfidence`、前端设置页「图片转写」叶子与转写卡片/探针组件、5 个 `IMAGE_TRANSCRIPTION_*` 环境变量。行为变化：图片附件一律直接发给主模型（等同该功能上线前）；联网图片证据回到原始 URL 列表——`read_url` 在「图片证据」段列出主图与候选图 URL，`web_search` 自动读取的每篇网页列出至多 4 条图片 URL，不再下载图片、不再调用识图模型判定相关性；模型支持 vision 时 `read_url` 仍把主图与至多 3 张候选图直接附给主模型；无 vision 模型加图仍被前端阻止（API 直连带图由上游报错原样透传）。无向后兼容：旧前端 POST `imageTranscriptionEnabled` 等未知键被忽略并返回 200，localStorage 里残留的 `image-transcription` 叶子落回默认叶子、显式渲染该 key 时输出「暂无可用的系统设置模块」占位（不白屏、不抛错），历史消息不再返回图片转写描述（「由 X 转写」文本消失，图片附件本身不动）
- 升级指引：执行 `pnpm --filter backend prisma migrate deploy` 应用 `20261113120000_remove_image_transcription`（`DROP COLUMN messages.image_descriptions_json` + `DELETE FROM system_settings WHERE key GLOB 'image_transcription_*'`），随后执行 `pnpm --filter backend prisma generate`；已部署环境同时删除 `.env` 里的 5 个 `IMAGE_TRANSCRIPTION_*` 变量
- BREAKING: 「对话与上下文」设置改由账号持有，提示词改为分层装配——「记住对话上下文」从浏览器 localStorage 迁到 `users.contextEnabled`（默认 `true`，新增迁移 `20261113000000_user_context_enabled`），服务端按「请求显式值 → 账号偏好 → `true`」解析并收敛到 `resolveContextEnabled`，压缩门与请求构建共用同一结果；移动端不再发送该字段，自动跟随账号。个人系统提示词由「替换全局 `chat_system_prompt`」改为独立偏好层（以 `[用户个人偏好]` 前缀追加在角色层之后，见 ADR-0039），管理员约束不再被用户单方面顶掉；同时设了会话提示词与个人偏好的账号，偏好层从此开始生效。UI 文案改为陈述真实作用域：开关只决定本会话历史是否随请求发送，消息照常入库，重新开启可继续
- BREAKING: 移除从未生效的「新对话继承上下文」开关（引入至今全仓无任何读取方，语义无法定义，见 ADR-0040）；提示词长度上限收敛为单一事实源——设置页计数不再写死 500，改读 `GET /api/settings/app-info` 的 `limits.system_prompt_max_length`（默认 12000）并设置输入框 `maxLength`。无向后兼容
- 升级指引：执行 `pnpm --filter @aichat/backend prisma migrate deploy` 应用 `20261113000000_user_context_enabled`，随后执行 `pnpm --filter @aichat/backend prisma generate`；老账号默认 `true`，行为不变
- feat: 新增模型可调用的扩展安装工具 `install_extension`——用户在聊天里贴一条 GitHub 链接，模型自行判断是远程 MCP、本地包 MCP 还是 Skill，服务端只读取白名单清单文件完成识别，随后安装、绑定并在 MCP 上真实握手 `tools/list` 验证工具清单；Skill 与 MCP 同时命中时返回候选让模型追问，不替用户猜。消息里没有 GitHub 链接时不会激活该工具，普通聊天不承担额外开销。同批补上 MCP 运行层（自实现 JSON-RPC 2.0 + Streamable HTTP / HTTP+SSE / stdio 三种传输，零新增依赖），本地包型在 `docker run -i` 受限容器内运行（cap-drop、no-new-privileges、pids/cpus/memory 限额），兑现 ADR-0015；同时修复聊天响应未把 `mcpService` 传给工具注册表、导致 MCP 工具此前根本不会注册的漏洞。权限沿用 ADR-0017：MCP 安装模板仍只有管理员可建，普通用户基于既有模板创建自己的连接。新增系统设置键 `extension_install_tool_enable`（能力扩展页头「AI 自助安装」，默认开启）与网关环境变量 `MCP_GATEWAY_*`。无 DB 迁移。
- UI: 「供应商与连接」的高级管理改为一行标题栏——去掉可折叠卡片、Key/健康四宫格统计、供应商筛选 chip、搜索框与状态/健康下拉，标题栏只保留「高级管理 + N 个端点组」和右侧「导入 / 导出 / 刷新」三个按钮（「新建连接」仍走页头），标题栏下方直接是连接列表；连接行内 Keys / 模型 / 更新改为一行灰色文字、编辑与删除改为文字按钮，窄屏自动换行。连接列表改为常显，不再需要先展开。无后端协议变更、无迁移。
- feat: 供应商接入协议合并 + Anthropic Messages 支持——设置页「供应商与连接」把原 OpenAI / OpenAI Responses 两张卡合并为一张 OpenAI 卡，卡内「接口协议」可选择 Chat Completions 或 Responses（落库仍为 `openai` / `openai_responses`，无数据迁移），连接数徽标合并统计；新增 Anthropic 供应商卡（官方端点 `https://api.anthropic.com/v1`，`x-api-key` + `anthropic-version: 2023-06-01`）。后端新增 `anthropic` provider：请求侧把内部 Chat Completions 形状转换为 Anthropic Messages（system/图片/工具/工具结果/thinking budget），响应侧把 Messages JSON 与 SSE 事件归一化回 OpenAI 形状，因此聊天流式、非流式、工具编排、标题摘要、上下文压缩、图片转写、Battle 与 OpenAI 兼容 API 共用同一条链路。升级：直接替换，无 DB 迁移；已有连接无需改动。
- 依赖安全升级（无 DB 迁移）：按 lockfile 全量审计后做「范围内更新 + 定向跨版本升级 + 传递依赖 override」三段处理，告警包从 44 个（11 critical / 127 high / 121 moderate / 21 low）降到 4 个，且全部是构建/移动端 CLI 的开发期传递依赖（0 critical / 1 high）。主要变更：`next` 14.2.5 → 15.5.29（修掉中间件鉴权绕过与 Image Optimization RCE 等 critical）、`eslint-config-next` 同步、`vitest` 1.6 → 4.1、新增 `vite` 7 直接依赖并把 resolve 收敛到单一版本、`zod` 3 → 4 与 `@hono/zod-validator` 0.4 → 0.9、`adm-zip` 0.5 → 0.6.1、`sharp` 0.34 → 0.35.5、`uuid` 9 → 11（移除 `@types/uuid`）、`katex` 0.16 → 0.19、`@hono/node-server` 1 → 2.1；根 `package.json` 新增 `pnpm.overrides`（prismjs / postcss / postcss-selector-parser / minimatch / glob / vite）把传递依赖强制落到已修复版本。代码适配只涉及 API 形态：Next 15 的 `params`/`cookies()` 改异步、sharp `failOnError` → `failOn`、zod 4 的 `z.record` 两参签名、hono `c.req.param()` 显式非空断言、vitest 4 的 `vi.fn<T>()` 泛型与 `vi.stubGlobal` 替代对未定义属性 spyOn。升级后 `pnpm install --frozen-lockfile`、三包类型检查、架构检查、`next build`、前端 607 个用例全绿；后端 853/854 通过，唯一失败 `skill-anthropic-compat` 由 `NODE_USE_ENV_PROXY=1` 让子进程 stderr 带 Node 警告引起，升级前同样失败。同时删除过期的 `package-lock.json`（npm 时代遗留，仍锁 next 14.2.5，而根 `workspace:*` 让 npm 无法解析）。
- fix: 修复弱网下 Markdown 格式渲染整体降级——Worker 首包不再静态打包 KaTeX/rehype-katex（构建产物 6.18 MB，改后仅在正文命中公式时按需加载），ready 握手改为 15 秒软等待（2g/3g 30 秒）且超时不终止 Worker，迟到 ready 会广播并让已降级消息自动重渲染；失败重建改为 10/20/40/60 秒指数冷却且不再永久停用，`online`、ready 与成功渲染都会清零预算；KaTeX 样式与字体改为随应用本地打包，移除 jsDelivr CDN 依赖。无后端协议变更、无迁移。
- fix: 修正 SQLite `DATABASE_URL` 的相对路径基准——Prisma 的 `file:./...` 以 `prisma/schema.prisma` 所在目录（`packages/backend/prisma`）为基准，而根 `.env` 与 `.env.example` 里写成 `file:./prisma/data/app.db` 会被静默解析到 `packages/backend/prisma/prisma/data/app.db`（另一个历史库），症状是「连上空库 / 缺列 / `prisma migrate` 显示已应用但运行时报 `no such column`」；统一改为 `file:./data/app.db`，并删除误生成的 `prisma/prisma` 目录。后端启动时会打印实际打开的 SQLite 文件（`[Prisma] SQLite file: ...`），检测到重复 `prisma` 目录时给出显式告警。无 DB 迁移，已有库不需要变动。
- fix: 启动期 bearer 连接诊断适配 `connection_groups` 拆分后的 schema——启动检查与 `scripts/check-broken-connections.ts` 改为 `connections JOIN connection_groups` 取 `provider`/`authType`，消除启动日志里的 `no such column: provider` 噪音。无迁移。
- build: 显式保障 `@aichat/shared` 的 dist 产出——前端/后端 Dockerfile 在复制源码后各自执行 `pnpm --filter @aichat/shared build`，CI 的 quality job 在 Shared build 后新增 Verify shared dist 断言（校验 `index.js` / `cot-timeline.js` / `cot-timeline-view.js` 均存在），避免 install 的 prepare 被过滤安装或缓存跳过后解析不到子路径入口。无迁移。
- UI: 过程时间轴改为三段折叠——完成态默认把整条 CoT 压成一行摘要（`过程时间轴 · N 步 · 搜索 x 次 · 命中 y 条 · 读取 z 篇 · 耗时`），点开后是每步一行的紧凑提纲（限高 `min(45vh,20rem)` 内部滚动，单步仍可就地下钻），再点「全部展开」才是逐卡细节层；流式作答期间自动落提纲层并跟随当前步骤，回答结束后自动收回收起态；折叠级别按消息 key 记入 sessionStorage（`aichat.cot_timeline_level:<key>`，只影响该条消息），状态机与一行摘要收敛到 `@aichat/shared/cot-timeline-view` 供 Web/Android 复用。无后端协议变更、无迁移。
- fix: 登录态改为滑动续期——JWT 与 Cookie 的 `maxAge` 统一由 `JWT_TTL_SECONDS` 决定（默认 86400 秒，可用范围 60 秒–365 天），令牌剩余寿命不足半个 TTL 时服务端在解析 actor 处自动重签并写回 HttpOnly Cookie，活跃会话不再在 24 小时处被硬踢；前端不再持久化 `actorState`，启动即以 `/auth/actor` 的服务端判定为准（Cookie 过期立即降级，不再出现「UI 已登录、后端已匿名」的错位）；新增 `COOKIE_SECURE` 显式覆盖与登录/注册页 401 重复跳转护栏。无 DB 迁移，升级只需 `docker compose pull && docker compose up -d`。
- UI: 折叠态推理卡由横向跑马灯改为单行上下滚屏——标题在上、CoT 内容在下，流式时逐行向下滚动且不循环，输出结束直接停在最后一行；工具卡保持原横向滚屏。无后端协议变更、无迁移。
- UI: CoT 与工具展示统一为平铺时间轴——推理卡与每个工具卡均为消息体一级兄弟元素，左侧带状态色时间轴轨道，顶部提供统一「全部展开/全部折叠」开关；各卡片仍独立折叠/持久化，不再共享「深度思考过程」总壳；主聊天 / 分享 / Battle / Android 四端统一组件语义与节点构建器。无后端协议变更、无迁移。
- 重构：将 web / mobile 的 `ChatStreamChunk → ToolEvent` 增量归约逻辑收敛至 `@aichat/shared/stream-message-reducer`（单一 `upsertToolEventFromChunk`），并删除 chat `stream-slice` 与 battle `useBattleFlow` 的 phase/status/stage/source 本地归一化副本；无行为变更、无迁移。
- fix: 修复工作区 Python 工具在 docker-socket-proxy 部署下「初始化 Python 虚拟环境失败（Permission denied）」——挂载路径翻译改为优先解析 `/proc/self/mountinfo`，不再依赖 `docker inspect <HOSTNAME>` 容器自检（HOSTNAME 与守护进程容器 ID 不一致时自检 404 会静默跳过翻译，导致沙箱挂载到 root 属主空目录而无法写 `.venv`）；venv 初始化报错附带 workspace 路径与挂载排查提示。无迁移、直接替换。
- fix: 交错步骤流流式打字机开头「前进又后退」——推理节点 key 按 charStart 稳定、追加文本不重置游标，并正确映射段内 playedLength。
- BREAKING UI: 推理与工具展示改为交错 CoT 步骤流（深度思考 ↔ 工具结果），主聊天 / 分享 / Battle / Android 四端统一；废除「思考过程 + 工具调用 N 个」汇总双卡主路径。迁移策略为无迁移、直接替换。
- 推理通道净化：切断工具 handler 经 `emitReasoning(kind=tool)` 写入 reasoning 的路径；工具进度仅走 Tool Event / 步骤流；历史污染文案展示时剥离（无 DB 迁移）。
- 后端工具事件补全 `reasoningOffsetStart`/`End`，供交错步骤流定位；消息级 `reasoningDurationSeconds` 仍用于过程壳总耗时（不伪造分段秒数）。
- BREAKING: 移除「推理默认展开」系统设置项 `reasoning_default_expand`（前端 `reasoningDefaultExpand`）与 `REASONING_DEFAULT_EXPAND` 环境变量；过程壳改为流式自动展开/完成折叠并支持按消息记忆手动状态；其余推理设置（`reasoning_enabled`、`reasoning_save_to_db`、`reasoning_tags_mode` 等）保留。迁移策略为无迁移、直接替换。
- 生产默认 Docker 拓扑改为 all-in-one：`ghcr.io/asheblog/aichat` 同容器运行 frontend + backend + rag-worker，并保留独立 `docker-socket-proxy`；旧四容器见 `docker-compose.split.yml`。升级：`docker compose pull && docker compose up -d`。1Panel 示例见 `docs/deploy/1panel-compose.example.yml`。
- BREAKING: 模型大乱斗改为统一入口下的双模式选择（`多模型大乱斗` / `单模型多问题大乱斗`）；`/battle/stream` 入参改为强制判别联合，必须显式传递 `mode`；迁移策略为无迁移、直接替换。
- 新增单模型多问题评测能力：支持单模型批量题目、每题独立 `runsPerQuestion/passK`（最多 3）、按题稳定性统计（`stabilityScore`/`questionStats`）、按题维度的 SSE 与结果持久化字段。
- 升级指引：执行 `pnpm --filter backend prisma migrate deploy` 应用 `20260304120000_add_battle_mode_and_questions`（新增 `battle_runs.mode` 与 `battle_results.questionIndex/questionId/questionTitle`），随后执行 `pnpm --filter backend prisma generate`。
- BREAKING: 系统设置导航从 13 个子页收敛为单一「配置中心」入口，模块改为页内二级分组切换（基础运行、模型与工具、知识与文档、治理与审计）；迁移策略为无迁移、直接替换。
- BREAKING: Python 工具链路切换为受管运行环境（持久化 venv），`python_runner` 与 Python Skill 统一使用受管解释器；移除并停用系统设置旧字段 `python_tool_command`、`python_tool_args`；迁移策略为无迁移、直接替换。
- BREAKING: 后端 Docker 镜像移除科学计算 Python 系统包预装，`python-runner` 默认依赖改为内置 Skill manifest 的 `python_packages` 并在容器启动时自动 reconcile；迁移策略为无迁移、直接替换。
- 新增系统设置模块「Python 运行环境」：支持在线配置索引、安装/卸载依赖、冲突告警与 reconcile；Skill manifest 新增 `python_packages`，在版本激活时自动安装并执行 `pip check`，失败即阻断激活。
- 新增 Skill 卸载接口与 dry-run 预览：删除第三方 Skill 时可先预览将删除/保留的 Python 包清单；执行卸载后自动清理安装包目录，并回收未被其他激活 Skill/手动保留依赖占用的 Python 包。
- BREAKING: Python 运行环境新增“执行时报缺库自动安装”能力（默认开启）；覆盖 `python_runner` 与 `runtime.type=python` Skill，且仅登录用户可触发自动补装。新增来源治理标签 `manual | skill_manifest | skill_auto | python_auto` 并在系统设置页可筛选展示；迁移策略为无迁移、直接替换。

## v1.9.0 · 2026-02-19

- BREAKING: 移除 URL Reader 开关配置（`enableUrlReader` 等），聊天与工具调用统一按新编排链路执行；迁移策略为无迁移、直接替换。
- Battle 对战支持“题目图片 + 期望答案图片”全链路能力：后端入库与执行器、前端流程与分享页、共享契约同步升级（含未推送提交 `453ec7c`）。
- Tool Orchestrator 重构为独立模块，并增强最大迭代控制：`maxIterations <= 0` 视为无限迭代，达到上限时抛出明确错误，Chat/Battle 行为保持一致。
- 错误处理增强：工具编排异常与 API 错误解析器补充结构化处理路径，并新增对应测试用例。
- 运行环境更新：后端 Docker 镜像增加 PuLP 线性规划依赖。
- 升级指引：执行 `pnpm --filter backend prisma migrate deploy` 应用 `20260218110000_add_battle_run_images`（新增 `battle_runs.promptImagesJson` 与 `battle_runs.expectedAnswerImagesJson`），随后执行 `pnpm --filter backend prisma generate`；Docker 部署请重建后端镜像。

## v1.3.8 · 2025-11-05

- 注册审批系统：移除环境变量 `APP_MODE`，改用 `DEFAULT_REGISTRATION_ENABLED` 控制注册开关；后端新增待审批/禁用状态与审批接口，首位注册用户自动成为管理员，其余用户需经审批；前端注册流程与用户管理页同步支持新的审批状态。
- 设置中心重构：重织设置导航、卡片布局与徽标标签，统一间距与图标语义，改进动画与响应式体验，整合系统/个人设置分组以提升可用性。
- 推理展开控制：为消息气泡引入系统级「默认展开推理」开关，支持在后台将 OpenAI Reasoning Effort 设置为 `unset` 以清除覆盖值；推理渲染会随配置更新保持同步。
- 欢迎页品牌文案：欢迎页页脚免责声明支持自定义品牌名称，当未配置时回退为 `AIChat`。
- 升级指引：执行 `pnpm --filter backend prisma migrate deploy` 应用用户审批相关迁移，并运行 `pnpm --filter backend prisma generate` 更新客户端。

## v1.3.7 · 2025-11-04

- 用户模型偏好持久化：新增数据库字段与API，同步匿名与登录会话的模型选择，并在前端默认选择器中自动记忆个人偏好。
- 弹窗无障碍增强：聊天界面、设置面板与欢迎页弹窗补充隐藏标题，为屏幕阅读器提供准确的语义提示。
- Markdown 处理稳健性：worker 渲染失败时返回空结果并在开发环境发出警告，避免未捕获拒绝导致界面异常。
- 数据库迁移：执行 `pnpm --filter backend prisma migrate deploy` 同步 schema，随后运行 `pnpm --filter backend prisma generate` 更新客户端。

## v1.3.6 · 2025-11-04

- 引入动态上下文窗口：后端根据模型目录 `metaJson` 元数据、Ollama API 响应与内置映射动态解析上下文长度，前端新增开关允许禁用上下文扩展；移除环境变量 `DEFAULT_CONTEXT_TOKEN_LIMIT`，请确保所有模型配置具备正确的上下文信息。
- 上下文与调用管控增强：聊天接口与统计模块会记录实时上下文使用情况，系统设置支持缓存上下文限制并校验 OpenAI Base URL，防止配置错误。
- Markdown 渲染性能优化：前端拆分消息元数据与渲染缓存，引入 worker 管道统一 Markdown 处理，新增虚拟滚动以提升长会话渲染性能，并优化代码块样式与推理内容展示。
- 依赖与类型更新：为虚拟滚动与 Markdown 渲染补充必要依赖，调整聊天存储结构与组件以适配渐进式渲染路径。

## v1.3.5 · 2025-10-31

- BREAKING: 移除个人连接功能，所有模型连接统一由系统管理员维护。升级后请在「系统设置 → 模型管理」中重新录入所需连接，旧个人连接即使保留在库中也不会再加载。
- 新增匿名访客模式：后端为未登录访客分配匿名会话与 Cookie，支持自定义保留天数（0-15 天）并在新消息写入时自动清理过期匿名会话与附件。
- 引入调用额度体系：系统设置可分别配置匿名访客与注册用户的每日额度，后端通过 `usage_quota` 表追踪用量并在超额时阻止请求。
- 聊天消息支持图片上传，本地保存在 `storage/chat-images` 并通过 `message_attachments` 表持久化；系统设置新增图片访问域名与保留天数选项，前端发送失败会自动回滚已选图片。
- 模型目录改为数据库缓存，新增后台自动刷新、连接变更触发与管理员手动刷新能力，降低外部 API 请求频率。
- API 与前端增强：聊天/开放兼容接口增加全链路流量日志；前端 API 客户端新增 `suppressAuthRedirect` 选项；主页取消强制登录跳转，未登录访问时仍可加载页面。
- 升级指引：运行 `pnpm --filter backend prisma migrate deploy` 应用数据库迁移（含 `message_attachments`、`usage_quota`），随后执行 `pnpm --filter backend prisma generate` 并重启服务；若需启用匿名访客，请在系统设置中开启注册及相关配额。

## v1.3.4 · 2025-10-29

- [7e5f232](https://github.com/your-username/aichat/commit/7e5f23226c05d0242d7cb20671e76b5190a01e1f) 调整聊天输入区布局、按钮悬停态与移动端安全区内边距，统一多端视觉体验。
- [7bb98a3](https://github.com/your-username/aichat/commit/7bb98a3f49d4c9a4e87034158293dfcf47ada8e8) 侧边栏改用语义化颜色令牌，确保亮暗主题下的层级与可读性一致。
- [805d132](https://github.com/your-username/aichat/commit/805d13272f80d09d0313840981cfb0d04ae99ae2) 将静态图片全面替换为Next.js `Image`，补足中文alt文本并收敛多处依赖数组，减少无效渲染。
- [e61d494](https://github.com/your-username/aichat/commit/e61d4945080ff506470caa6ca9df7df29fa01f92) 登录/注册页面抽离复用的`AuthFormLayout`，移除冗余Shell组件，降低表单布局重复代码。
