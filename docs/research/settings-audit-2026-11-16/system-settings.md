# 系统设置审计：品牌与界面 / 用户与注册 / 推理与网络 / 数据与维护 / 日志与审计

审计日期 2026-11-16。代码基线：本工作区 `main`（只读审计，未改业务代码、未起服务、未读 .env 与真实用户数据）。本文件是基线审计的原始记录，逐项“建议”为当时结论；最终采纳与实施见 [设置精简实施与升级](implementation.md)，冲突时以实施文档为准。

本文件只覆盖 5 个叶子：`branding`、`users-registration`、`reasoning-network`、`data-maintenance`、`logs-audit`。供应商与连接、模型管理、搜索与知识库、能力扩展、概览与导航由其他分项报告覆盖。

## 口径

- **默认值**一律取**代码默认**，不取部署实值（部署值未读取）。
- 本仓有三处默认值来源，含义不同，逐项表里都写出来：
  1. **运行时默认**：`resolveStreamConfig` / 各 service 的 `fallback`。聊天链路读的是**数据库原始行**（`loadSystemSettingsMap` 只返回已存在的 key，不补默认），因此"没有这一行"时生效的是这一层。
  2. **管理面板显示默认**：`SettingsService.getSystemSettings` 的 `read(key, fallback)`。这是管理员打开设置页看到的当前值，**不参与运行时计算**。
  3. **前端 codec 兜底**：`parseSystemSettingsPayload` 的 `?? default`。
- **建议**取值：保留 / 合并 / 收进高级 / 删除入口 / 自动化 / 修复。**删入口 ≠ 删功能**，两者分开给结论。
- 证据写成 `路径:行`，路径相对仓库根。
- 本版据复核调整两处结论：`streamKeepaliveIntervalMs` 由"无前端消费＝无用"降级为"与 SSE 心跳重复、删前需验证代理保活"；`assistantReplyHistoryLimit` 由"只移除入口"改为"暂保现值、先解耦版本保留与 `usageMetric`"。**后者已被用户最终决定覆盖：取消版本上限，入口、契约与裁剪整体删除，全部版本与 `usageMetric` 保留（见 P0-2 末尾与 [implementation.md](implementation.md)）。** 两个 0 语义缺陷（P0-1）原样保留，由汇总报告独立核读。

## 字段总账

| 叶子 | FIELD_MAP 条目 | 其中非存储 | 对应真实 system_settings 行 | 非 schema 可调项 |
|---|---|---|---|---|
| branding | 11 | 2（`assistantAvatarUpload`、`assistantAvatarUrl`） | 9 + 1（`assistant_avatar_path` 未进 FIELD_MAP） | 0 |
| users-registration | 3 | 0 | 3 | 0 |
| reasoning-network | 19 | 0 | 19 | 0 |
| data-maintenance | 15 | 0 | 15 | 0 |
| logs-audit | 0 | 0 | 0 | 3（`level`/`toFile`/`retentionDays`，走 `/system-logs/config`） |
| **合计** | **48** | **2** | **47** | **3** |

映射源：`packages/shared/src/settings-contract.ts:1-113`（`SYSTEM_SETTINGS_FIELD_MAP`）。`assistant_avatar` 只是上传入参的传输别名，后端从不写这一行（`packages/backend/src/services/settings/settings-service.ts:778-791` 写的是 `assistant_avatar_path`）；`assistant_avatar_url` 由 GET 现算（同文件 `:469-470,504-510`）。

---

## 1. 品牌与界面（`branding`）

卡：`branding:avatar`、`branding:branding`（`packages/frontend/src/components/settings/system-settings-registry.tsx:243-244`）。

| 中文名 | key | 默认值 | 用途 | 建议 | 决定性原因 | 证据 |
|---|---|---|---|---|---|---|
| 文字 LOGO | `brandText` | `''`（面板回退 `AIChat`） | 顶栏/欢迎页品牌名，≤40 字符 | 保留 | 公开品牌接口与前端首屏都读它，改它比改 CSS 更省事；也是唯一站点名来源 | `settings-contract.ts:13`；`settings-service.ts:310,128`；`api/settings.ts:119`；`branding-card.tsx:209-230` |
| 主色 | `brandPrimary` | `''`（空＝内置暖橙） | 覆盖 `--primary`/`--ring`/`--sidebar-active`/`--accent-color` | 保留，收进高级 | 一次改色带动 4 个变量 + hover 派生 | `packages/shared/src/brand-theme.ts:17,99-108`；`settings-service.ts:607-622` |
| 主色前景 | `brandPrimaryForeground` | `''` | 覆盖 `--primary-foreground` | 保留，收进高级 | 与主色成对，单独出现会得到不可读按钮 | `brand-theme.ts:18` |
| 背景色 | `brandBackground` | `''` | 覆盖 `--background`/`--background-alt` | 保留，收进高级 | **只在浅色生效**（`LIGHT_ONLY_KEYS`），深色主题不受影响 | `brand-theme.ts:19,26-31,118-131` |
| 表面色 | `brandSurface` | `''` | 覆盖 `--surface`/`--card`/`--popover` | 保留，收进高级 | 同上，浅色限定 | `brand-theme.ts:20` |
| 前景色 | `brandForeground` | `''` | 覆盖 `--foreground`/`--card-foreground`/`--popover-foreground` | 保留，收进高级 | 同上，浅色限定 | `brand-theme.ts:21` |
| 次要前景 | `brandMutedForeground` | `''` | 覆盖 `--muted-foreground` | 保留，收进高级 | 同上，浅色限定 | `brand-theme.ts:22` |
| 全局系统提示词 | `chatSystemPrompt` | `''` | 角色层提示词，会话未设时生效 | 保留，**改文案** | 实现是"会话 > 全局 > 内置默认"三选一互斥，个人提示词是**追加层**；卡片写的"会话 > 个人 > 全局"与实现和领域模型都相反 | `packages/backend/src/agent-runtime/chat-request-builder.ts:133-151`；`CONTEXT.md:15-16`；`branding-card.tsx:236,250-252` |
| 图片访问域名 | `siteBaseUrl` | `''`（回退 env `SITE_BASE_URL`） | 头像/聊天图/分享/生图 URL 前缀 | 保留 | 至少 6 条链路直接读这一行，删了会出坏图 | `settings-service.ts:359,509-510`；`packages/backend/src/utils/profile-images.ts:129-131`；`utils/chat-images.ts:353-354`；`services/shares/share-service.ts:223-229`；`modules/chat/image-generation-response.ts:68-73`；`chat-stream-use-case.ts:1209-1214` |
| AI 回复头像 | `assistantAvatarUpload` / `assistantAvatarUrl` | `null` | 上传（≤1MB，自动裁剪）或清除全局 AI 头像 | 保留，**修清除不删文件** | 上传写 `assistant_avatar_path` 并派生 URL；清除只把 path 置空字符串，磁盘文件成孤儿（个人头像走 `replaceProfileImage(null)` 会真删） | `settings-service.ts:469-470,504-510,778-791`；`profile-images.ts:79-103,143-156`；`services/settings/personal-settings-service.ts:144-148` |

管理操作（非字段）：`刷新图片域名` → `POST /chat/admin/attachments/refresh`（`packages/backend/src/modules/chat/routes/attachments.ts:18`），保留。

---

## 2. 用户与注册（`users-registration`）

卡：`users-registration:policy`、`users-registration:users`（`system-settings-registry.tsx:240-241`）。

| 中文名 | key | 默认值 | 用途 | 建议 | 决定性原因 | 证据 |
|---|---|---|---|---|---|---|
| 开放用户注册 | `allowRegistration` | `true` | 允许自助注册 | 保留，**补"注册后仍需审批"** | 首个用户永远 `ADMIN/ACTIVE` 且绕过开关；之后注册一律 `PENDING`，必须管理员审批才能登录。开关文案只说"允许自行注册"，读不出第二道闸门 | `packages/backend/src/services/auth/auth-service.ts:99-118`；`api/settings.ts:117`；`registration-policy-card.tsx:128-143` |
| 匿名访客每日额度 | `anonymousDailyQuota` | `20` | 未登录用户每日次数，0＝禁用匿名 | 保留 | `quota-service` 用它当 ANON 默认上限；设 0 后任何正成本请求都判 `OVER_LIMIT`，是真正的"关闭匿名"开关 | `services/settings/system-settings-service.ts:159-162`；`services/quota/quota-service.ts:205-232` |
| 注册用户默认每日额度 | `defaultUserDailyQuota` | `200` | 用户每日默认上限 | 保留，**改文案** | 它不只作用于新用户：所有没设 `customDailyLimit` 的用户**实时跟随**该值。文案写"新注册用户的初始额度，可单独调整"会让人以为老用户不受影响 | `quota-service.ts:206-232`；`system-settings-service.ts:164-167`；`registration-policy-card.tsx:186-202` |

管理操作：

| 操作 | 建议 | 决定性原因 | 证据 |
|---|---|---|---|
| 同步匿名额度（`POST /settings/system/anonymous-quota/reset`） | 保留 | 把共享匿名额度行的 `customDailyLimit` 清空并可选清零 `usedCount`；这是改完额度后让已生效记录跟上的唯一入口 | `quota-service.ts:151-182`；`settings-service.ts:811-814`；`registration-policy-card.tsx:73-86` |
| 审批通过 / 拒绝 / 启用 / 禁用 / 改角色 / 删除 / 单用户额度 / 批量启停删 | 保留 | 与注册开关配套；删除用户会级联删会话与消息（确认框已声明不可恢复） | `components/settings/system-users/use-system-users.tsx:268-313,315-349,394-440` |

---

## 3. 推理与网络（`reasoning-network`）

卡：`reasoning-network:reasoning`、`:stream`、`:network`（`system-settings-registry.tsx:252-254`）。整页单保存，payload 19 键（`ReasoningNetworkPage.tsx:224-244`）。运行时全部经 `resolveStreamConfig` 消费（`chat-stream-use-case.ts:857-868,929-935`）。

| 中文名 | key | 默认值（运行时 / 面板 / codec） | 用途 | 建议 | 决定性原因 | 证据 |
|---|---|---|---|---|---|---|
| 启用推理链 | `reasoningEnabled` | `true` / `true` / — | 采集 `reasoning_content` 与 CoT 标签并折叠展示 | 保留 | 关闭后不仅不采集，**也不剥离标签**，原始 ` thinking` 会留在正文里 | `stream-config-resolver.ts:115`；`chat-stream-use-case.ts:1684,1701-1717` |
| 保存到数据库 | `reasoningSaveToDb` | `true` / **`false`** / `true` | 是否把推理文本落库 | 保留，**修默认值** | 三处默认不一致：无数据行时面板显示"关闭"，运行时却按 `true` 落库；管理员以为自己关了 | `stream-config-resolver.ts:116` vs `settings-service.ts:349` vs `chat-stream-use-case.ts:557-561`；`packages/shared/src/settings-codec.ts:239` |
| 标签模式 | `reasoningTagsMode` | `default` / `default` / `default` | 默认标签集 / 自定义 / 关闭剥离 | 保留 | `off` 只在 `reasoningEnabled` 为真时有意义；两者是 AND 关系 | `stream-config-resolver.ts:117-119`；`chat-stream-use-case.ts:1701-1706` |
| 自定义标签 | `reasoningCustomTags` | `''` | 形如 `["<a>","</a>"]` | **合并**进标签模式行 | 只有 `custom` 模式读它；后端不校验，非法 JSON 静默退回默认标签，用户不会被告知 | `stream-config-resolver.ts:121-135`；`reasoning-config-card.tsx:144-151` |
| 默认生成 Tokens | `reasoningMaxOutputTokensDefault` | `32000` / `32000` / — | `max_tokens` 的第三级兜底 | 保留，**改名并移出"推理链"** | 它不是推理专属：层级为 catalog `metaJson` → 内置已知表 → 本值。`deepseek-chat` 命中已知表 4096 后本设置完全无效 | `services/context/context-window-service.ts:33-36,185-224`；`chat-request-builder.ts:255-261` |
| 默认温度 | `temperatureDefault` | `0.7` / `0.7` / — | 全量请求 temperature | 保留，**移出"推理链"卡** | 对所有聊天请求生效，与推理无关；层级 catalog `metaJson.temperature` → 本值 → 0.7；Anthropic 转换会把值再钳到 0~1 | `chat-request-builder.ts:797-857,248-253`；`utils/anthropic-convert.ts:295-298` |
| 流式增量聚合（分片大小） | `streamDeltaChunkSize` | `1` / **`3`** / `1` | 累计 N 片才 flush | 保留（高级） | 与 flush 间隔是 AND 关系：两个条件都满足才推 | `stream-config-resolver.ts:138-142`；`chat-stream-use-case.ts:1533-1542`；`settings-service.ts:352` |
| 正文 flush 间隔 | `streamDeltaFlushIntervalMs` | `0` / `0` / `undefined` | 0＝只按分片触发 | 保留（高级），**改占位提示** | 输入框占位写"800"、描述写"推荐 800ms"，但实际默认 0；空提交存 0 | `stream-config-resolver.ts:143-147`；`stream-performance-card.tsx:61-72` |
| 推理 flush 间隔 | `streamReasoningFlushIntervalMs` | 未设时**继承正文 flush** / `0` / `undefined` | 同上，作用于推理通道 | **合并**进正文 flush | 只有一条独立语义：缺省继承；卡片占位"1000"与实际不一致 | `stream-config-resolver.ts:148-152`；`stream-performance-card.tsx:74-85` |
| Keepalive 间隔 | `streamKeepaliveIntervalMs` | `0` / `0` / `undefined` | 空闲时发 `{type:'keepalive'}` 事件 | **合并进 SSE 心跳（合并前先验证代理保活）** | 前端确实没有消费分支（`stream-events.ts` 只处理 content / reasoning / reasoning_unavailable / usage / quota / complete），但**没有消费不等于无用**：定期写入事件本身能维持中间代理/网关的连接活性。它和 `sseHeartbeatIntervalMs` 的 `: ping` 是同一目的的两套机制，属重复而非死逻辑。合并或删除入口前，必须在真实反代（nginx/Cloudflare/企业网关）下验证 `: ping` 已足够保活 | `stream-sse-service.ts:138-147`；`chat-stream-use-case.ts:1575-1578`；`packages/frontend/src/features/chat/store/slices/stream-events.ts:176-261` |
| OpenAI reasoning_effort | `openaiReasoningEffort` | `unset` / `unset` / `''` | 会话未选强度时的默认 | 保留（高级），**改描述** | 层级为 请求 > 会话 > 本值 > env（ADR-0045 明确"默认"回落系统值）。值按原样写入 `body.reasoning_effort`，AIChat 不收敛；只有 Anthropic 转换层把 `max/xhigh` 翻成 16384 预算 | `chat-request-builder.ts:626-652`；`anthropic-convert.ts:18-25,323-332`；`use-composer-feature-flags.ts:78-95`；`docs/adr/0045-composer-write-first-model-effort-and-tool-disclosure.md:11` |
| SSE 心跳间隔 | `sseHeartbeatIntervalMs` | `15000` / `15000` / `15000` | SSE `: ping` 周期 | 保留，**补说明** | 它同时是**所有空闲/超时检查的 tick 精度**（`Math.max(1000, hb)`），调大等于把下面 4 个超时的判定粒度一起调粗 | `stream-sse-service.ts:98,148` |
| 上游最大空闲 | `providerMaxIdleMs` | `60000` / **`30000`** / `60000` | 面板称"上游最大空闲" | **删除入口** | 全仓只被读进一个从未使用的局部变量，无任何消费者 | `stream-config-resolver.ts:88-92,208`；`chat-stream-use-case.ts:867`（唯一引用，未再使用） |
| 上游总体超时 | `providerTimeoutMs` | `300000` / `300000` / `300000` | 单请求总时限 | 保留，**补第二处用途** | 真实消费者在 request-builder 与压缩摘要调用；resolver 里算出的 120000 从不生效（被 `providerRequest.timeoutMs` 覆盖） | `chat-request-builder.ts:873-880`；`chat-stream-use-case.ts:868,1025,1061`；`modules/chat/services/conversation-compression-service.ts:184`；`stream-config-resolver.ts:93-97`（值未用） |
| 推理初始宽限 | `providerInitialGraceMs` | `120000` / **`0`** / `120000` | 首帧前最长等待，超过取消上游 | 保留，**修默认值** | 面板显示 0（＝不设首帧超时），实际 120000 到点就 `cancelProvider`；反向误读会让人以为"不会超时" | `stream-sse-service.ts:105-115`；`stream-config-resolver.ts:98-102` vs `settings-service.ts:321` |
| 推理阶段空闲上限 | `providerReasoningIdleMs` | `300000` / **`0`** / `300000` | 收到首帧后思考期最长静默 | 保留，**修默认值** | 同上：面板 0，实际 5 分钟静默即取消 | `stream-sse-service.ts:121-126`；`stream-config-resolver.ts:103-107` vs `settings-service.ts:322` |
| 推理保活提示间隔 | `reasoningKeepaliveIntervalMs` | `0` / `0` / `0` | 静默期发"思考中" | 保留 | 前端确实消费（`reasoningStatus='idle'`）；`>0` 时会**抢占**上一条 stream keepalive 分支（`else if`） | `stream-sse-service.ts:127-137`；`stream-events.ts:182-199` |
| 推送用量（usage） | `usageEmit` | `true` / **`false`** / `true` | 流中推 usage 事件 | 保留，**修默认值** | 无数据行时面板显示关闭、运行时却是开；关闭只影响流中事件，`complete` 事件仍无条件带 usage，前端最终数字不会丢 | `chat-stream-use-case.ts:863,1384,1962,1997-2016`；`stream-events.ts:233-251`；`settings-service.ts:327` |
| 仅透传厂商 usage | `usageProviderOnly` | `false` / `false` / `false` | 关闭时结束前补估算 | 保留 | 与上一条联动：`usageEmit` 关时本项无效果 | `chat-stream-use-case.ts:864,1962` |

---

## 4. 数据与维护（`data-maintenance`）

卡：`retention`/`compression`/`concurrency`/`task-trace`/`system-log`（`system-settings-registry.tsx:246-250`）。

| 中文名 | key | 默认值 | 用途 | 建议 | 决定性原因 | 证据 |
|---|---|---|---|---|---|---|
| 聊天图片保留天数 | `chatImageRetentionDays` | `30` | 清理过期聊天图片附件 | 保留，**必须修 0 语义**（见 P0-1） | 文案写"0 表示永久保留"，实现是 `cutoff = now - 1000ms`，即**立刻删掉所有更早的附件**；且每次请求都触发一次（节流 1 小时，`chat-image-service.ts:20,233`） | `services/attachment/chat-image-service.ts:231-276`（内含 `:240-249`）；`chat-request-builder.ts:859-871`；`retention-policy-card.tsx:99-120` |
| 乱斗历史保留天数 | `battleRetentionDays` | `15` | 清理已结束的 battle 与 share | 保留 | 这里的 0 真的是"关闭清理"（`<=0` 直接 return），与文案一致；`>0` 会连图删 battleRun/Result/Share | `services/battle/battle-retention-cleanup-service.ts:86-97,134-160,199-215`；`services/battle/battle-service.ts:426`；`retention-policy-card.tsx:122-138` |
| 单条消息 AI 回答上限 | `assistantReplyHistoryLimit` | `5` | 同一用户消息最多保留几个回答版本 | **删除（用户最终决定）**：取消版本上限，全部版本与历史用量保留，不提供手动删除版本功能（见 P0-2 末尾） | 基线实现 `ensureVariantWindow` 会删最旧兄弟消息**并删其 usageMetric**；最终实现只重排 `variantIndex`，入口/契约/迁移一并移除（[implementation.md](implementation.md)） | `modules/chat/assistant-message-service.ts`（基线删除分支已移除）；`chat-stream-use-case.ts`（不再推导上限）；`retention-policy-card.tsx`（入口移除） |
| 匿名访客数据保留天数 | `anonymousRetentionDays` | `15`（`clamp 0~15`） | 匿名会话保留时长 | 保留，**必须修 0 语义**（见 P0-1） | 文案写"0 表示永久保留"，实现 `retentionDays <= 0` 分支**无条件清空所有匿名会话**（每批 50、60 秒节流） | `services/cleanup/anonymous-cleanup-service.ts:44-70`；`system-settings-service.ts:152-157`；`chat-stream-use-case.ts:359`；`retention-policy-card.tsx:158-173` |
| 启用压缩 | `contextCompressionEnabled` | `true` | 长会话自动摘要压缩 | 保留 | 与用户级 `users.contextEnabled`（是否发历史）是两层不同含义，不重复 | `modules/chat/services/conversation-compression-service.ts:91-95`；`agent-runtime/request-options.ts:30`；`CONTEXT.md:14` |
| 压缩触发阈值 | `contextCompressionThresholdRatio` | `0.5`（`0.2~0.9`） | 按模型上下文窗口算触发点 | 保留 | 阈值是 `contextLimit × ratio`，随模型自适应，不是绝对 token | `modules/chat/services/conversation-compression-service.ts:97-118` |
| 压缩后保留消息数 | `contextCompressionTailMessages` | `12`（`4~50`） | 末尾 N 条进保护集 | 保留 | 保护集同时包含本轮 `protectedMessageId`，删它会改变当前轮上下文 | `modules/chat/services/conversation-compression-service.ts:103-108,156-167` |
| 最大并发数 | `chatMaxConcurrentStreams` | `1`（`1~8`） | 同一 actor 并发流上限 | 保留 | 以 `maxActorStreams` 生效，超额返回 429；agent 路径同用 | `services/chat/stream-meta-store.ts:110-120`；`chat-stream-use-case.ts:606-627,772-782` |
| 启用任务追踪 | `taskTraceEnabled` | `false` | 记录后台执行事件 | 保留，**与"可用环境"合并** | 单独打开没有任何输出：还要过 env 闸门 + adminOnly + 请求标记 | `services/task-trace/legacy-utils.ts:60-88` |
| 默认启用 | `taskTraceDefaultOn` | `false` | 请求未显式要求时也追踪 | 保留 | `defaultOn=false` 时必须有请求侧 `traceToggle` 才记录，否则 `opt_out` | `legacy-utils.ts:78-85`；`chat-stream-use-case.ts:508-513` |
| 仅限管理员 | `taskTraceAdminOnly` | `true` | 非管理员不可手动开启 | 保留 | 与上方 `canUseTrace`（前端）同一判据 | `legacy-utils.ts:73-77`；`use-composer-feature-flags.ts:76` |
| 可用环境 | `taskTraceEnv` | `dev` | 限制 dev/prod/both | **合并**进启用开关，或默认改 `both` | 生产容器 `NODE_ENV=production` 时默认 `dev` 恒判 `env_blocked`——管理员打开"启用任务追踪"后仍然一条不记 | `legacy-utils.ts:65-72`；`task-trace-config-service.ts:58-59` |
| 保留天数 | `taskTraceRetentionDays` | `7` | 清理历史追踪 | **改自动化** | 没有任何调度器：只有卡片上的"立即清理"走 `POST /task-trace/cleanup`。卡片描述"会被自动清理"不成立 | `api/task-trace.ts:514-532`；`services/task-trace/task-trace-service.ts:276-297`；`task-trace-card.tsx:165-194` |
| 单条追踪最大事件数 | `taskTraceMaxEvents` | `2000` | 单条追踪事件上限 | 保留，**修下限** | API 与 settings 层允许 100，配置服务把下限钳到 200：填 100~199 会被静默抬到 200 | `api/settings.ts:208`；`settings-service.ts:460`；`task-trace-config-service.ts:61` |
| 心跳超时告警 | `taskTraceIdleTimeoutMs` | `30000` | 静默超时写 `keepalive_timeout` | 保留 | 同时被流式层当作 `traceIdleTimeoutMs`，每轮只告警一次 | `services/stream/stream-config-resolver.ts:198-202`；`stream-sse-service.ts:118-120`；`chat-stream-use-case.ts:1523,1597-1602` |

管理操作：查看追踪总数（`getTaskTraces`）、立即清理（`cleanupTaskTraces`）、跳转日志页；日志卡的统计/清理见下节。

---

## 5. 日志与审计（`logs-audit`）+ 系统运行日志卡

`logs-audit` 叶子本身**没有任何可调字段**，是三个只读视图：Skill 审计 / 任务追踪 / 运行日志（`components/settings/pages/SystemSkillAudits.tsx:50-69`）。全部日志配置都在"数据与维护"的系统运行日志卡（`system-log-card.tsx:97-200`），走独立接口 `/system-logs/config`，**不在 system_settings 表里**。

| 中文名 | 字段 | 默认值 | 用途 | 建议 | 决定性原因 | 证据 |
|---|---|---|---|---|---|---|
| 日志级别 | `level` | `debug`（非生产）/ `info`（生产），env `LOG_LEVEL` 覆盖 | 输出详细度 | 保留，**移到日志与审计叶子** | 纯内存变量，重启回落到 env 默认；配置和查看分在两个叶子 | `packages/backend/src/utils/logger.ts:46-59,71-74` |
| 写入文件 | `toFile` | `true`（env `SYSTEM_LOG_TO_FILE`） | 同时落 JSON Lines | 保留 | 同上不落库；关掉后统计与清理都读不到文件 | `logger.ts:48,75-77`；`system-log-card.tsx:127-136` |
| 保留天数 | `retentionDays` | `7`（env `SYSTEM_LOG_RETENTION_DAYS`） | 清理旧日志文件 | **改自动化或并进清理按钮** | 只影响"立即清理"的默认值；`cleanupOldLogFiles()` 仅在清理路由里被调用，没有定时任务 | `logger.ts:50,140-160`；`api/system-logs.ts:129-176`（`:159` 唯一调用点） |
| 立即清理 | `POST /system-logs/cleanup` | — | 删过期文件并返回释放字节 | 保留 | 唯一真正删文件的操作 | `api/system-logs.ts:150-176`；`system-log-card.tsx:79-95` |

---

## 6. 跨项缺陷（按严重度）

### P0-1　"0 = 永久保留"在两处实现成"立刻全删"

- `chatImageRetentionDays=0` → `effectiveDays === 0` 走 `new Date(now - 1000)`，所有更早的 `messageAttachment` 连同文件被删（`chat-image-service.ts:246-249,261-270`）。触发点是每次请求的 `scheduleImageCleanup`（`chat-request-builder.ts:128,859-871`），节流 1 小时（`chat-image-service.ts:20,233`）。
- `anonymousRetentionDays=0` → `retentionDays <= 0` 分支不看时间，直接清空匿名会话（`anonymous-cleanup-service.ts:44-54`），每批 50 条、60 秒一次，由聊天/completion 路由触发（`chat-stream-use-case.ts:359`；`modules/chat/routes/completion.ts:160`）。
- 同一张卡里 `battleRetentionDays=0` 才是真正"关闭清理"（`battle-retention-cleanup-service.ts:87-97`）。三个 0 三种含义，文案统一写"永久保留"。
- 建议：先把两项 0 语义改成"不清理"（与文案一致），再决定是否继续提供输入框；修复前不应把这几个字段当作"可精简"项处理。

### P0-2　`assistantReplyHistoryLimit`：入口、固定值与删除行为必须分开决策（基线分析；最终决定见本节末尾）

基线实现 `ensureVariantWindow`（`assistant-message-service.ts:136-198`，实施后删除分支已移除）的行为：

1. 取同一 `parentMessageId` 下全部兄弟消息，按 `createdAt,id` 升序；
2. 超出上限时删**最旧的、非本次目标**的兄弟（`:175-180`），目标版本永远保留；
3. 删除时先 `usageMetric.deleteMany`（`:195-196`）再 `message.deleteMany`（`:196`）；
4. 对存活版本重排 `variantIndex`（`:182-192`）。

三种可选行为，影响不同，不能合并成一句"改成固定 5"：

| 行为 | 用户可见后果 | 数据后果 | 判定 |
|---|---|---|---|
| A. 只去掉可调入口，值固定 5 | 界面不再声称可调；第 6 个版本出现时最旧版本消失 | 仍删消息 + 删 usageMetric → 会话/按天用量统计会**变小**；且部署里已配置的 1–20 被静默作废 | **不建议**：既丢掉已配置值，又保留删除行为 |
| B. 保留入口且保持可调（暂保现值） | 现有 1–20 的部署配置继续有效；界面不变 | 同现状，无新增数据影响 | **基线采纳，已被覆盖**：用户最终选 C；当时"暂保"只为避免只删入口留下删除行为并静默作废已配置值 |
| C. 改为不自动删（保留全部版本） | 历史版本永不消失，可回溯；重新生成与版本切换沿用原入口 | 无需手动清理版本入口；会话历史增长与重新生成成本由用户自行承担 | **用户最终采纳**：取消上限，全版本与 `usageMetric` 保留，不新增手动删除版本功能 |

结论（最终决定，已实施）：**取消 `assistantReplyHistoryLimit`**。设置入口、共享契约字段与 `ensureVariantWindow` 的删除分支一并删除；所有回答版本与其 `usageMetric` 保留，`variantIndex` 只做 1..N 重排，重新生成与版本切换语义不变；**不需要新增"手动删除某个版本"功能**。迁移删除存量 `assistant_reply_history_limit` 行，升级不清空聊天数据（[implementation.md](implementation.md)）。基线当轮"暂保现值"的结论已被本条覆盖，保留在上文仅作原始判断记录；当时提出的"先解耦版本保留与消耗统计"由"全保留"直接满足——不再有版本删除，也就不存在统计回退。

### P0-3　同一字段三处默认值不一致（面板显示 ≠ 运行时）

| key | 运行时（无数据行） | 管理面板显示 | 前端 codec | 用户可感知后果 |
|---|---|---|---|---|
| `reasoningSaveToDb` | `true` | `false` | `true` | 以为关着，实际在存推理文本 |
| `usageEmit` | `true` | `false` | `true` | 以为关着，实际在推 usage |
| `providerInitialGraceMs` | `120000` | `0` | `120000` | 以为不设首帧超时，实际 2 分钟就取消上游 |
| `providerReasoningIdleMs` | `300000` | `0` | `300000` | 以为不设思考期超时，实际 5 分钟取消 |
| `providerMaxIdleMs` | `60000` | `30000` | `60000` | 该字段本身无消费者（见 P1-1） |
| `streamDeltaChunkSize` | `1` | `3` | `1` | 面板显示的分片与真实分片不同 |
| `providerTimeoutMs` | `300000`（另有一条 120000 的死值） | `300000` | `300000` | 显示正确，但 resolver 里那份 120000 是误导性死值 |

根因：`getSystemSettings` 用 `read(key, fallback)` 造显示值（`settings-service.ts:310-371`），聊天链路用 `loadSystemSettingsMap` 只取真实行（`services/chat/request-context.ts:38-45`）。建议统一到一份"字段 → 默认值"表，GET 与 resolver 都从它取值。

### P1-1　一个已判死的配置 + 一个待验证的重复项

- **`providerMaxIdleMs`（判死）**：`chat-stream-use-case.ts:867` 读入局部变量后从未使用；全仓无其他消费，也没有任何代码路径把它交给代理或 fetch。可以按"无消费者"处理。
- **`streamKeepaliveIntervalMs`（重复，未判死）**：后端确实定期发 `{type:'keepalive'}`（`chat-stream-use-case.ts:1575-1578`），前端 `stream-events.ts` 与 mobile 包都没有对应分支——但**前端不消费不能推出无用**：流式响应里定期写出事件本身就是在给中间代理/负载均衡喂字节，能防止连接被 idle 超时切断。它和 `sseHeartbeatIntervalMs` 的 `: ping` 目的相同，属于两套保活机制重复，应合并（保留一个节奏），而不是直接删掉。真正的风险点在于两者的生效顺序：
  - `: ping` 由心跳定时器无条件发送，节奏 = `sseHeartbeatIntervalMs`（`stream-sse-service.ts:98-101`）。
  - `{type:'keepalive'}` 只在"首帧之后、存在空闲、且距上次 keepalive 超过阈值"时发，并且**被 `reasoningKeepaliveIntervalMs` 分支以 `else if` 抢占**（`stream-sse-service.ts:127-147`）。
  - 因此把 `reasoningKeepaliveIntervalMs` 设为 `>0` 时，stream keepalive 实际上不再触发；两者不是独立的两层保障。
- 合并前需要验证：目标部署的反向代理/网关 idle 超时（常见 60s/100s）是否已被 `: ping` 覆盖。验证通过后再删入口并统一到心跳；验证不通过则保留其一，并把两个节奏合并成一个输入。

### P1-2　保存失败仍然提示"已保存"

`settings-store.updateSystemSettings` 捕获异常后只 `set({error})` 并正常 resolve（`packages/frontend/src/store/settings-store.ts:136-157`）；各卡随后无条件 `toast('已保存')`。`error` 只在 `settings === null` 时渲染（如 `DataMaintenancePage.tsx:41-50`）。后果：`brandText` 清空（zod `min(1)`，`api/settings.ts:119`）、`chatSystemPrompt` 超 12000、非法自定义标签等，都会被后端 400 拒绝，界面却报成功，刷新后值回滚。`chatSystemPrompt` 的 Textarea 也没有 `maxLength`（`branding-card.tsx:241-249`）。

### P1-3　两个"自动清理"实际都不自动

- 系统日志保留天数：无调度，只在手动清理时作为默认值（见第 5 节）。
- 任务追踪保留天数：无调度，只有 `POST /task-trace/cleanup`（`api/task-trace.ts:514-532`）。
- 卡片描述（`system-log-card.tsx:140`、`task-trace-card.tsx:167`）都写"会被自动清理"。要么加定时任务，要么改文案。

### P1-4　任务追踪四道闸门串联

`enabled` → `env`（生产默认被拒）→ `adminOnly` → `defaultOn/请求标记`（`legacy-utils.ts:60-88`）。打开总开关不产生任何记录；`maxEvents` 填 100~199 还会被配置服务钳到 200。

### P1-5　全局提示词生效顺序文案与领域模型相反

实现与 `CONTEXT.md:15-16` 都是：角色层三选一（会话 > 全局 > 内置默认），个人提示词是**追加层**。卡片写"生效顺序：会话 > 个人 > 全局"（`branding-card.tsx:251`），会让人以为个人提示词能顶掉全局。

### P2　其余文案/默认值偏差

- `streamDeltaFlushIntervalMs` 占位"800"、`streamReasoningFlushIntervalMs` 占位"1000"、`streamKeepaliveIntervalMs` 占位"5000"，描述写"推荐"，实际默认全 0（`stream-performance-card.tsx:61-98`）。
- `temperatureDefault` 允许 0~2，但 Anthropic 路径被钳到 0~1（`anthropic-convert.ts:295-298`）。
- `openaiReasoningEffort` 的 `max`/`xhigh` 原样透传给 OpenAI 兼容端点，只有 Anthropic 转换层解释；描述"仅对支持该参数的模型生效"没有说明越界值可能被上游 400（`chat-request-builder.ts:640-653`）。
- 清除 AI 头像不删磁盘文件（`settings-service.ts:789-791`）。
- `reasoningMaxOutputTokensDefault` 名称与位置都指向"推理"，实际是通用 `max_tokens` 兜底。

---

## 7. 分层核对（global / model / user / session）

| 能力 | global（system_settings） | model（ModelCatalog.metaJson） | user（users） | session | 是否重复 |
|---|---|---|---|---|---|
| 温度 | `temperatureDefault` | `metaJson.temperature` 优先 | 无 | 无 | 否，是明确的"模型 > 全局 > 0.7"回退链 |
| `max_tokens` | `reasoningMaxOutputTokensDefault` | `custom_max_output_tokens`/`max_output_tokens` 优先 | 无 | 无 | 否，第三级兜底 |
| 思考强度 | `openaiReasoningEffort` | 无 | 无 | `reasoningEffort`（含 null 清除） | 否，ADR-0045 规定会话选"默认"时回落系统值；方向与温度相反（有会话层、无模型层） |
| 每日额度 | `defaultUserDailyQuota` | 无 | `usageQuota.customDailyLimit` 覆盖 | 无 | 否，是真分层；但文案把全局层说成"只影响新用户" |
| 系统提示词 | `chatSystemPrompt` | 无 | `personalPrompt`（**追加**） | `systemPrompt`（角色层优先） | 否；但 UI 把三选一 + 追加错写成四级覆盖 |
| 上下文 | `contextCompressionEnabled` 等 3 项 | 无 | `contextEnabled`（是否发历史） | 请求可显式覆盖 | 否，两层含义不同 |
| 保留策略 | `chatImageRetentionDays`/`battleRetentionDays`/`anonymousRetentionDays`/`taskTraceRetentionDays`/`ragRetentionDays` | 无 | 无 | 无 | 否，对象各不相同；问题是三个可填 0 的字段语义不统一（见 P0-1） |

结论：**没有发现"同一含义在两处可配"的真重复**。真正的重复是两类：① 同一字段的默认值在 GET / resolver / codec 出现三次（P0-3）；② 两个 keepalive 键目的相同、机制重叠（其中一个前端不消费，但仍承担代理保活，属重复而非死逻辑，见 P1-1）。

---

## 8. 删入口 vs 删功能

| 项 | 只删 UI 入口 | 若连功能一起删 |
|---|---|---|
| `streamKeepaliveIntervalMs` | **不能直接删**：前端不消费≠无作用，它仍在给中间代理喂字节。先验证代理保活、再合并进心跳 | 删功能＝只剩 `: ping` 一条保活路径，须在真实反代下确认足够后才可做 |
| `providerMaxIdleMs` | 安全：无消费者 | 删 resolver 字段即可，无行为变化 |
| `reasoningCustomTags` | 入口合并后 `custom` 分支仍需读它 | 若删字段，须把 `custom` 模式一并删掉，否则该模式永久失效 |
| `taskTraceEnv` | 删入口会让生产环境**永久无法追踪**（默认 dev 恒被拒） | 必须同时把 env 判断改成默认放行 |
| `assistantReplyHistoryLimit` | **已删除**：入口、共享契约与裁剪逻辑一并移除（用户决定取消上限） | 不再裁剪版本；全部回答版本与 `usageMetric` 保留，不提供手动删除版本功能 |
| `chatImageRetentionDays` / `anonymousRetentionDays` | 删入口不改变清理逻辑，**0 语义缺陷仍在** | 删功能会让附件与匿名会话永久堆积，需另给清理策略 |
| 日志 `level`/`toFile`/`retentionDays` | 删入口后 env 仍生效 | 删功能＝关闭文件日志，日志页三视图里两个断数据源 |
| `siteBaseUrl` | 删入口会破坏头像/分享/生图 URL 拼接 | 功能级删除会牵连 6 处调用，不建议 |
| 6 个品牌色 | 删入口后已存的行**仍生效**（CSS 覆盖），必须连数据一起清 | 连同 `brand-theme` 一起删才彻底 |
| `allowRegistration` | 删入口后注册恒定开放，属安全性回退 | 不建议 |

---

## 9. 实际不确定性

1. `max`/`xhigh` 在非 Anthropic 上游是否 400：本轮未发真实请求，需按端点实测（`chat-request-builder.ts:645-649` 无收敛逻辑）。
2. ~~版本清理对用量报表的量化影响~~：已不再适用——版本清理整体删除，`usageMetric` 不再被连带清除，该风险随"全版本保留"消失。
3. `usageMetric` 之外是否还有别处按消息聚合消耗（例如按消息统计接口）：本报告只核到会话与按天两条聚合路径。
4. `streamKeepaliveIntervalMs` 能否安全合并进 SSE 心跳：取决于目标部署的反向代理/网关 idle 超时是否已被 `: ping` 覆盖。本轮未起服务、未抓代理日志，无法判定；前端侧只核到 `stream-events.ts` 与 mobile 包未见 `{type:'keepalive'}` 消费。
5. 部署实值（`.env`）未读取，因此"面板显示的默认"与"当前生产实际值"可能不同；本报告所有"默认值"均为代码默认。
6. `logs-audit` 三个 tab 的数据源健全性（Skill 审计表、trace 文件目录、日志目录）未做端到端验证，只核了配置入口。

---

## 10. 建议动作（按优先级）

1. **修两个 0 语义**（P0-1）：`chatImageRetentionDays`、`anonymousRetentionDays` 的 0 改为"不清理"，与 `battleRetentionDays` 对齐。这是删数据风险，先于任何精简。
2. **统一默认值口径**（P0-3）：建立单份"字段 → 运行时默认"表，GET 与 resolver 共用；至少修 `reasoningSaveToDb`、`usageEmit`、`providerInitialGraceMs`、`providerReasoningIdleMs`、`streamDeltaChunkSize` 五项。
3. **取消版本上限（已实施）**（P0-2）：删除入口、共享契约与裁剪逻辑，全部回答版本与 `usageMetric` 保留，不新增手动删除版本功能；基线"暂保现值"结论作废（[implementation.md](implementation.md)）。
4. **一个删、一个合**（P1-1）：`providerMaxIdleMs` 按无消费者删除；`streamKeepaliveIntervalMs` **不按死逻辑删**，先验证反向代理保活是否已由 `: ping` 覆盖，再把两套 keepalive 合并成一个节奏（并处理它与 `reasoningKeepaliveIntervalMs` 的抢占关系）。
5. **修"保存成功"提示**（P1-2）：store 更新失败要抛出，或页面读取 `error` 后提示失败。
6. **补自动化或改文案**（P1-3）：日志与追踪保留天数二者选一。
7. **合并/收编**：`streamReasoningFlushIntervalMs` 并进正文 flush（缺省继承已是现状）；`reasoningCustomTags` 并进标签模式行；`taskTraceEnv` 并进启用开关（默认 `both`）；日志三项从"数据与维护"移到"日志与审计"叶子。
8. **文案修正**：注册后需审批、默认额度对全员生效、提示词三层关系、`providerTimeoutMs` 的第二处用途（压缩摘要）、`reasoningMaxOutputTokensDefault` 改名。
9. **明确不删的项**：`siteBaseUrl`、6 个品牌色、三个保留天数、`allowRegistration`、两个 usage 开关均保留；它们的删除牵连面都大于收益。
