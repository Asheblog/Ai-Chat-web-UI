# 个人偏好 / 账号 / 模型 / 连接 / 访问控制 设置审计

- 仓库：`E:\codebase\aichat`，分支 `main`（worktree `settings-users-main`，基线提交 `bb376960`）
- 审计日期：2026-11-16
- 方法：只读代码（read / grep / glob），未启动服务、未运行浏览器、未读取 `.env`、凭据或用户数据
- 唯一写入：本文件
- 覆盖核对基准：`docs/research/settings-audit-2026-11-16/field-inventory.json`（111 个 `SYSTEM_SETTINGS_FIELD_MAP` 映射字段）

## 结论摘要（按影响排序）

1. **`manualOverride` 一个布尔承载四类覆写（能力 / 访问策略 / 温度 / 上下文档），任一保存都会冻结该模型的能力自动刷新并阻止过期清理。** 保存访问策略 → 该模型 `capabilitiesJson`/`tagsJson` 从此不再随上游目录刷新（`model-catalog-service.ts:406,414` 无条件置 true；`utils/model-catalog.ts:314-317,323-325` 按该标记跳过写入与清理）。这是本次最该修的语义耦合。
2. **"重置覆写 / 清除全部覆写"删除的是整行，不是某个字段。** 重置能力的同一操作会连带清掉访问策略与温度（`model-catalog-service.ts:431-471`），而 UI 文案写的是"移除全部模型能力覆写配置"（`SystemModelsPage.tsx:350`），用户看不到自己还丢了访问控制。
3. **能力自动探测的层序与直觉相反：连接默认 < 供应商声明 < 按模型名猜。** `mergeCapabilityLayers` 后者覆盖前者（`utils/capabilities.ts:54-76`），刷新时启发式排在最后一层（`utils/model-catalog.ts:264-270`），所以"系统推断"会压掉"供应商标注"。建议改为 provider > heuristic。
4. **`连接标签` 与 `默认能力` 是同一能力的两个入口，且能互相矛盾。** 标签名 `vision`/`image_generation` 会经 `computeCapabilities` 生效（`utils/providers.ts:77-84,292-308`），与连接卡里的"默认能力"勾选重复；取消勾选但标签仍写着 `vision` 时，刷新层仍会判为支持。
5. **连接编辑器里 `认证方式` 的 `session` 是无消费点的伪选项；`system_oauth` 只能读环境变量。** `buildHeaders` 只处理 `bearer` / `system_oauth`（`utils/providers.ts:111-134`），`session` 直接落到"不加任何认证头"；Prisma 注释也写明 `session` 只是"预留"（`schema.prisma:508`）。
6. **`连接类型 external/local` 没有任何运行时分支。** 值只被复制进模型目录行（`utils/model-catalog.ts:89,293,307`）并回传前端，前端 store 声明后从未读取（`store/models-store.ts:14`）。
7. **连接组 `enable` 字段存在，但 API 与 UI 都没有入口**（`api/connections.ts:28-40` 的 schema 不含 enable），只能整组删除；列表"健康度"只是按 Key 启用数推导（`view-model.ts:27-33`）。
8. **个人设置入口重复两套结构**：独立页 4 分区（`settings-layout-client.tsx:56-61`），弹窗 5 项含"关于"（`nav.tsx:44-54`）；主题切换在两处（`PersonalPreferences.tsx:159-178` 与 `user-menu.tsx:89-101`），且主题是浏览器本地 `next-themes` 状态，不随账号走。
9. **`preferredModel` 是无 UI 的自动化项**：选模型即写服务端 `users.preferredModel*` 与 localStorage（`use-chat-session-controls.ts:93-102`、`model-preference-store.ts:60-98`）。
10. **深度思考关闭时思考强度被静默吞掉**：`enabled=false` 会删除 `reasoning_effort`（`chat-request-builder.ts:645-652`），但输入区仍允许设置强度（`model-selector-effort.tsx:13-20`），界面没有联动禁用。
11. **`shareTitle` 有 PATCH 能力但无 UI 入口**：`updateShareSchema` 支持 title（`api/shares.ts:21-24`），分享管理只提交 `expiresInHours`（`ShareManagement.tsx:118-147`）。
12. **残留下线引用**：`settings-dialog.tsx:13` 仍注释着 `./pages/PersonalModels`，该页面文件不存在。

## 审计口径

| 类别 | 定义 | 计数字段 |
| --- | --- | --- |
| 可配置字段 | 用户能改、且值会被持久化并影响行为的项 | **36** |
| 管理操作 | 一次性动作（导入/导出/验证/刷新/删除/撤销/改密/上传） | 不计入 36 |
| 只读信息 | 状态、摘要、版本、密钥掩码、验证结果 | 不计入 36 |
| 归属其他代理 | 技能 / MCP / 知识库 / 搜索 / Python / 任务追踪 / 系统级推理与网络参数 | 不重复展开 |

- 36 项里只有 **2 项**属于 `SYSTEM_SETTINGS_FIELD_MAP`（`modelAccessDefaultAnonymous`、`modelAccessDefaultUser`，`packages/shared/src/settings-contract.ts:33-34`），其余是账号列、模型目录覆写、连接组列或会话偏好，**不在 111 字段清单内**，汇总时请勿按"缺失字段"处理。
- 默认值一律取代码默认（`DEFAULT_FORM`、Prisma `@default`、解析函数 fallback、前端常量），不是部署实值。

---

## A. 账号级个人偏好（6 项）

| # | 中文名 | key | 默认 | 真实作用（消费点） | 建议 | 决定性理由 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 用户名 | `username` | 无（必填，3-20 位 `[a-zA-Z0-9_]`） | 登录名；唯一性校验 + 全站显示名 | 保留 | 账号身份本体，不可删 | `PersonalPreferences.tsx:32-67,137-157`；`personal-settings-service.ts:129-142`；`api/settings.ts:466` |
| A2 | 头像 | `avatar`（存 `users.avatar_path`） | `null` | 个人头像；上传/清除两动作，服务端换成文件路径 | 保留（配置值），上传/清除算管理操作 | 值是持久资产，不是开关；删它等于删用户资料字段 | `PersonalPreferences.tsx:69-109,122-136`；`personal-settings-service.ts:144-149` |
| A3 | 界面主题 | `theme`（next-themes，无服务端字段） | `system` | 只切根节点 class；不随账号同步 | 合并入口 | 同一状态有两个控制点（个人资料卡 + 用户菜单），保留任一即可；存储是浏览器本地，不是账号设置 | `app/layout.tsx:48-53`；`PersonalPreferences.tsx:159-178`；`user-menu.tsx:89-101` |
| A4 | 记住对话上下文 | `contextEnabled`（`users.contextEnabled`） | `true` | 决定本会话历史是否随请求发送；服务端收敛为"请求显式值 → 账号偏好 → true"，压缩门与请求构建共用 | 保留 | 关闭后必须真的只发当前消息；ADR-0040 已把它从 localStorage 迁到账号列，回退会重演换设备失效 | `conversation-context-card.tsx:105-119`；`schema.prisma:33`；`request-options.ts:14-31`；`chat-request-builder.ts:126` |
| A5 | 个人系统提示词 | `personalPrompt`（`users.personalPrompt`） | `null` | 以 `[用户个人偏好]` 前缀作为独立 system 消息追加在角色层之后；上限读 `app-info.limits.system_prompt_max_length` | 保留（作为偏好层），但计数器上限需与后端同源 | ADR-0039 明确它不能再顶掉管理员 `chat_system_prompt`；上限只有一个事实源，写死即回归 | `conversation-context-card.tsx:36-45,120-144`；`chat-request-builder.ts:134-151`；`api/settings.ts:467`；`constants/prompt.ts:14-18` |
| A6 | 首选模型 | `preferredModel.modelId` / `preferredModel.connectionId` / `preferredModel.rawId`（`users.preferredModelId/preferredConnectionId/preferredModelRawId`） | 全部 `null` | 选模型时自动写服务端 + localStorage，用于下次进入时回填 | 自动化（保持无 UI） | 它是选择结果不是配置项；三键必须整体替换，单独暴露任一键都会产生半匹配身份 | `model-preference-store.ts:60-98`；`use-chat-session-controls.ts:93-102`；`personal-settings-service.ts:122-127`；`schema.prisma:28-30` |

## B. 分享管理（1 项）

| # | 中文名 | key | 默认 | 真实作用（消费点） | 建议 | 决定性理由 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | 分享有效期 | `expiresInHours` | `null`（不自动失效） | 写 `chat_shares.expiresAt`；读取与状态徽标都按它判过期；服务端允许 1–720 小时 | 保留 | 是唯一真正影响分享可达性的用户参数；快捷值 24/72/168/720/null 与服务端上限 720 一致 | `ShareManagement.tsx:19-25,118-157,266-293`；`api/shares.ts:18,21-24` |

## C. 模型目录与能力（5 项）

| # | 中文名 | key | 默认 | 真实作用（消费点） | 建议 | 决定性理由 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | 图片理解 | `capabilities.vision`（`model_catalog.capabilities_json`） | 未定义（UI 显示关） | 决定主模型是否接收图片/是否走视觉链路；会话能力解析直接读该字段 | 保留，但需与连接层入口去重 | 是能力判定唯一落点；未定义时回落到标签/启发式，删掉会让用户无法纠正自动误判 | `SystemModelsPage.tsx:464-479`；`use-system-models.tsx:109-147`；`model-capabilities.ts:18-38`；`model-catalog-service.ts:264-276` |
| C2 | 图像生成 | `capabilities.image_generation` | 未定义（UI 显示关） | 决定是否允许图像生成工具/路由 | 保留（同 C1 去重） | 同 C1 | `system-models/constants.ts:4-10`；`SystemModelsPage.tsx:291-323`；`model-catalog-service.ts:264-276` |
| C3 | 生成 Tokens 上限 | `maxOutputTokens`（存 `meta_json.custom_max_output_tokens`，1–256000） | `null` → 供应商默认 | 优先级：模型覆写 → 已知模型表 → 系统 `reasoningMaxOutputTokensDefault` → 1 | 保留（高级） | 模型级覆盖是唯一能纠正猜错上限的入口；但空值语义必须保持"回落到表/系统值" | `use-system-models.tsx:149-184`；`SystemModelsPage.tsx:554-594`；`context-window-service.ts:185-224` |
| C4 | 上下文窗口 | `contextWindow`（`meta_json.context_window`，>0） | `null` → 已知模型表 → 系统上下文上限 → 报错 | 决定历史裁剪与压缩门 | 保留（高级） | 猜错就直接截断或超限报错，用户唯一补救手段 | `use-system-models.tsx:186-221`；`SystemModelsPage.tsx:638-678`；`context-window-service.ts:135-174` |
| C5 | 温度 | `temperature`（`meta_json.temperature`，0–2） | `null` → 系统 `temperature_default` 0.7 | 请求体采样温度；按 `manualOverride desc` 选行 | 保留（高级） | 逐模型覆盖是必要的；与系统默认值分层清晰，无重复存储 | `use-system-models.tsx:223-258`；`SystemModelsPage.tsx:596-636`；`chat-request-builder.ts:797-839`；`settings-service.ts:485` |

## D. 访问控制（4 项）

| # | 中文名 | key | 默认 | 真实作用（消费点） | 建议 | 决定性理由 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | 默认允许匿名访问 | `modelAccessDefaultAnonymous`（`model_access_default_anonymous`） | `deny` | 未覆写模型的匿名判定；同时过滤非管理员模型列表 | 保留 | 系统级安全默认，删掉等于所有未覆写模型对匿名开放（系统设置字段，属 111 清单） | `SystemModelAccess.tsx:186-196`；`settings-service.ts:471-474`；`system-settings-service.ts:242`；`model-catalog-service.ts:305-309` |
| D2 | 默认允许注册用户访问 | `modelAccessDefaultUser`（`model_access_default_user`） | `allow` | 同上，注册用户维度 | 保留 | 与 D1 对称，缺一不可（111 清单字段） | `SystemModelAccess.tsx:197-207`；`settings-service.ts:475-478`；`system-settings-service.ts:243` |
| D3 | 模型匿名访问策略 | `accessPolicy.anonymous`（`meta_json.access_policy.anonymous`：allow/deny/inherit） | 未定义 = 继承 | 单模型三态；非 inherit 时覆盖默认；请求解析与列表共用 | 保留 | 三态语义必要，"禁止"与"继承"结果不同时无法用布尔表达 | `SystemModelAccess.tsx:142-149`；`use-system-models.tsx:260-283`；`model-access-policy.ts:55-87`；`model-resolver-service.ts:160-193` |
| D4 | 模型注册用户访问策略 | `accessPolicy.user` | 未定义 = 继承 | 同上 | 保留 | 同上 | `SystemModelAccess.tsx:150-157`；`model-access-policy.ts:68-70,86` |

## E. 模型连接编辑（连接组 + 凭据，15 项）

| # | 中文名 | key | 默认 | 真实作用（消费点） | 建议 | 决定性理由 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | 显示名称 | `displayName` | 必填（模板预填 label） | 连接列表、模型选择器消歧；系统级必填且唯一（`allocateUniqueDisplayName`） | 保留 | 模型选择器靠它区分同名模型，删除会退化成"猜供应商" | `SystemConnectionEditor.tsx:121-129`；`connection-service.ts:30,910`；`shared/model-display.ts:152`；`api/connections.ts:29` |
| E2 | 接口协议 | `provider` | `openai` | 决定请求构造、鉴权头、SSE 能力、目录拉取路径 | 保留 | 唯一协议开关；ADR-0035 已把协议收敛到 4 个受支持值 | `form-state.ts:56`；`SystemConnectionEditor.tsx:131-149`；`ProviderProtocolField.tsx`；`api/connections.ts:30` |
| E3 | API 端点 | `baseUrl` | 空（模板预填官方端点） | 所有上游请求基址；`sanitizeBaseUrl` 去尾斜杠 | 保留 | 自建网关的唯一入口 | `SystemConnectionEditor.tsx:151-169`；`connection-service.ts:198,524` |
| E4 | DeepSeek 兼容 Thinking | `thinkingDialect`（off / deepseek_compat） | `off`；OpenAI 新建时按 baseUrl 推断 | 决定请求体是否注入 `thinking:{type:enabled/disabled}` | 保留 | ADR-0036 的正式表达；删掉会让 DeepSeek 系端点失去思考开关 | `SystemConnectionEditor.tsx:171-190`；`chat-request-builder.ts:650-652`；`form-state.ts:167-170` |
| E5 | 认证方式 | `authType` | `bearer` | 决定是否解密 Vault 密钥并加鉴权头 | 删除 `session`，`system_oauth` 降为环境变量说明或移出 UI | `session` 无任何消费分支（无认证头），Prisma 注明"预留"；`system_oauth` 只读全局 `SYSTEM_OAUTH_TOKEN`，连接级语义是假的 | `SystemConnectionEditorParts.tsx:38-54`；`utils/providers.ts:111-134`；`chat-request-builder.ts:667-685`；`schema.prisma:508` |
| E6 | 连接类型 | `connectionType`（external/local） | `external` | 仅写入模型目录行并回传；无运行时分支 | 删除 | 没有任何行为差异，纯噪音项；保留成本是每次排查都要判断它是否生效 | `SystemConnectionEditorParts.tsx:55-68`；`utils/model-catalog.ts:89,293,307`；`store/models-store.ts:14` |
| E7 | Prefix ID | `prefixId` | `null` | 拼 `modelId = prefix.rawId`：目录主键、会话 modelLabel、模型解析与温度匹配都用它 | 合并进显示身份 / 收敛为自动 | 与 `displayName` 争夺"消歧"职责（ADR-0034 已把身份交给连接组）；同时它参与解析，手改会让存量会话的模型身份失效 | `SystemConnectionEditorParts.tsx:70-77`；`model-catalog-service.ts:340`；`model-resolver-service.ts:96-100,173`；`session-service.ts:174` |
| E8 | 标签 | `tags` | `[]` | 列表展示 + **能力启发式输入**（`vision`/`image_generation` 标签会直接置能力） | 合并到"默认能力" | 同一能力两个入口且可互相矛盾：取消勾选但留标签，刷新层仍判支持 | `SystemConnectionEditorParts.tsx:79-86`；`utils/providers.ts:77-84,292-308`；`model-catalog-service.ts:290` |
| E9 | 自定义 Headers | `headers` | 空（`{}`） | 合并进上游请求头；不覆盖已有同名头 | 保留（高级） | 兼容网关的必需逃生口；服务端还会再拦一层禁区头 | `SystemConnectionEditorParts.tsx:88-96`；`form-state.ts:83-111`；`chat-request-builder.ts:765-795` |
| E10 | 默认能力 · 图片理解 | `defaultCapabilities.vision` | `false` | 能力刷新时作为 `connection_default` 层 | 保留（作为唯一能力入口，接收 E8） | 连接级默认是批量纠偏的正确层次；层序需修正（见摘要 3） | `system-connections/constants.ts:9-12`；`SystemConnectionEditorParts.tsx:98-116`；`utils/model-catalog.ts:151,264-270` |
| E11 | 默认能力 · 图像生成 | `defaultCapabilities.image_generation` | `false` | 同上 | 保留 | 同上 | `system-connections/constants.ts:1-12`；`utils/model-catalog.ts:151` |
| E12 | API Key | `apiKeys[].apiKey` | 空（bearer 必填） | 写入 Secret Vault，仅保存引用；调用前解密 | 保留 | 凭据本体；ADR-0023 已统一到 Vault | `SystemConnectionKeyPool.tsx:155-174`；`connection-service.ts:506-511`；`chat-request-builder.ts:667-677` |
| E13 | Key 标签 | `apiKeys[].apiKeyLabel` | `Key N` | 列表与验证结果里的人读标识 | 保留 | 多 Key 池必需的可读标识，不参与线路身份 | `SystemConnectionKeyPool.tsx:142-153`；`connection-service.ts:45-51` |
| E14 | Model IDs 白名单 | `apiKeys[].modelIds` | `[]` → 自动枚举 | 非空时直接用这些 ID 合成目录、不请求 `/models`；同时是解析兜底匹配源 | 保留 | 网关常不实现 `/models`；删掉会让这类端点目录为空 | `SystemConnectionKeyPool.tsx:175-192`；`utils/providers.ts:312-314`；`model-resolver-service.ts:106-124` |
| E15 | Key 启用 | `apiKeys[].enable` | `true` | 影响目录拉取选 Key、连接健康度、可用性 | 保留 | 停用单个坏 Key 不清除凭据，是可回滚操作的核心 | `SystemConnectionKeyPool.tsx:112-123`；`utils/model-catalog.ts:127-134`；`view-model.ts:23-33` |

## F. 聊天内模型与请求设置（5 项）

| # | 中文名 | key | 默认 | 真实作用（消费点） | 建议 | 决定性理由 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | 深度思考 | `reasoningEnabled`（`chat_sessions.reasoningEnabled`） | `null` → 系统 `reasoningEnabled`（true） | 关闭时不仅不注入 `reasoning_effort`，`deepseek_compat` 还会注入 `thinking.disabled` | 保留 | 唯一能整体关思考的会话开关，且会连带清掉强度，语义必须显式 | `chat-request-builder.ts:615-652`；`use-chat-session-controls.ts:65-72`；`schema.prisma:65` |
| F2 | 思考强度 | `reasoningEffort`（六值 + unset） | `null`（unset） | 优先级：请求 → 会话 → 系统 `openai_reasoning_effort` → 环境变量；unset 用 `null` 落库清除 | 保留，但需与 F1 联动禁用 | 与 F1 语义重叠：思考关闭时强度仍可点但完全不生效（界面无提示） | `model-selector-effort.tsx:13-23`；`use-chat-session-controls.ts:82-91`；`chat-request-builder.ts:626-632`；`api/sessions.ts:16,25` |
| F3 | 会话系统提示词 | `systemPrompt`（`chat_sessions.systemPrompt`） | `null` → 全局 `chatSystemPrompt` → 内置默认 | 角色层最高优先；与个人提示词分层追加 | 保留；把"提示词模板"管理移出该弹窗 | 角色层不可删，否则会话无法约束输出；模板 CRUD 是管理操作，混在设置弹窗里扩大面积 | `chat-composer-panel.tsx:477-600`；`chat-request-builder.ts:137-151`；`api/sessions.ts:17,26` |
| F4 | 自定义请求头 | `customHeaders`（localStorage `aichat:custom-request:<sessionId>`） | `[]`，最多 10 条 | 只补缺失头，禁区头（authorization/cookie/host 等）被丢弃 | 保留（高级） | 兼容网关必需；限制与禁区已在前后端各守一层 | `use-advanced-request.ts:47-62`；`chat-composer-panel.tsx:430-475`；`chat-request-builder.ts:765-795` |
| F5 | 自定义请求体 | `customBody`（同一 localStorage 键） | 空 | 深合并非保护键；`model/messages/stream` 锁定 | 保留（高级） | 唯一能做厂商私有参数的入口；保护键保证不会破坏会话语义 | `use-advanced-request.ts:34-45`；`chat-request-builder.ts:92,724-763` |

---

## 管理操作与只读信息（不计入 36）

| 位置 | 项 | 类型 | 证据 |
| --- | --- | --- | --- |
| 连接-高级管理 | 导入连接与密钥（含明文 Key，二次确认） | 管理操作 | `SystemConnectionsHeader.tsx:37-44`；`SystemConnections.tsx:285-302`；ADR-0028 |
| 连接-高级管理 | 导出连接与密钥（明文，仅迁移） | 管理操作 | `SystemConnectionsHeader.tsx:45-52`；`SystemConnections.tsx:272-283` |
| 连接-高级管理 / 编辑器 | 刷新列表、验证连接 | 管理操作 | `SystemConnectionsHeader.tsx:53-60`；`SystemConnectionEditor.tsx:242-259`；`use-system-connections.tsx:148-180` |
| 连接-编辑器 | 验证结果（每 Key 成功/失败/模型清单） | 只读 | `SystemConnectionEditor.tsx:262-272`；`SystemConnectionVerifyPanel.tsx` |
| 连接-列表 | 健康度、Keys 数、模型数、更新时间、Key 掩码 | 只读 | `SystemConnectionList.tsx:115-126`；`view-model.ts:23-40` |
| 连接-编辑器 | 添加/删除 Key 条目 | 管理操作 | `SystemConnectionKeyPool.tsx:59-63,124-134` |
| 模型管理 | 手动获取最新（刷新目录） | 管理操作 | `SystemModelsPage.tsx:207-210`；`use-system-models.tsx:389-404` |
| 模型管理 | 导出 / 导入覆写配置 | 管理操作 | `SystemModelsPage.tsx:219-246`；`use-system-models.tsx:425-496` |
| 模型管理 | 清除全部覆写 / 重置单个覆写 / 批量重置 | 管理操作（**牵连 D3/D4/C5**） | `SystemModelsPage.tsx:228-231,346-361,327-344`；`model-catalog-service.ts:431-471` |
| 模型管理 | 批量开/关能力、批量访问策略 | 管理操作 | `SystemModelsPage.tsx:280-324`；`SystemModelAccess.tsx:261-300` |
| 访问控制 | 搜索、仅看有覆写、分页、手动刷新 | 视图状态（不持久化） | `SystemModelAccess.tsx:43-68,233-259`；`use-system-models.tsx:53-63` |
| 个人资料 | 上传/清除头像 | 管理操作 | `PersonalPreferences.tsx:69-109` |
| 账号安全 | 修改密码（当前/新/确认 + 服务端强校验） | 管理操作（**不是可删参数**） | `PersonalSecurity.tsx:21-45,80-166`；`features/auth/api` |
| 分享管理 | 复制链接、打开分享、撤销、刷新、搜索 | 管理操作 | `ShareManagement.tsx:84-116,168-185,294-303` |
| 会话提示词弹窗 | 提示词模板：搜索/新建/更新/置顶/删除 | 管理操作（应移出设置弹窗） | `chat-composer-panel.tsx:500-576` |
| 关于 | 版本、提交、技术栈、更新日志 | 只读（**不是设置字段**） | `About.tsx:14-58`；`nav.tsx:52` |

## 优先级矩阵（global → user → session → model，以及请求）

| 维度 | 值 | 覆盖顺序（左高右低） | 证据 |
| --- | --- | --- | --- |
| 上下文开关 | 会话历史是否发送 | 请求 `contextEnabled` → `users.contextEnabled` → `true` | `request-options.ts:14-18` |
| 系统提示词 | 角色层 + 偏好层 | 会话 `systemPrompt` → 系统 `chatSystemPrompt` → 内置默认；**再加** `users.personalPrompt` 偏好层 | `chat-request-builder.ts:133-151` |
| 思考开关 | 是否推理 | 请求 `reasoningEnabled` → 会话 `reasoningEnabled` → 系统 `reasoningEnabled` → 环境变量 | `chat-request-builder.ts:615-624` |
| 思考强度 | effort | 请求 → 会话 `reasoningEffort` → 系统 `openaiReasoningEffort` → 环境变量 | `chat-request-builder.ts:626-632` |
| 温度 | sampling | 模型 `meta_json.temperature`（`manualOverride desc`） → 系统 `temperatureDefault` → 0.7 | `chat-request-builder.ts:797-839` |
| 生成上限 | max tokens | 模型 `custom_max_output_tokens` → 已知模型表 → 系统 `reasoningMaxOutputTokensDefault` → 1 | `context-window-service.ts:185-224` |
| 上下文窗口 | context | 模型 `context_window` → 已知模型表 → 系统上下文上限 → 抛错 | `context-window-service.ts:135-174` |
| 模型能力 | vision / image_generation | 模型覆写 `capabilitiesJson` → 标签/启发式 `computeCapabilities`；刷新时层序为连接默认 < 供应商 < 启发式 | `model-capabilities.ts:18-38`；`utils/model-catalog.ts:264-270`；`utils/capabilities.ts:54-76` |
| 访问决策 | allow / deny | 单模型 `access_policy` → 系统默认 → 管理员恒 allow | `model-access-policy.ts:55-87` |
| 模型选择 | 用哪个模型 | 会话 `connectionId+modelRawId` → 个人 `preferredModel*`（仅回填） | `use-chat-session-controls.ts:58-63,93-102` |

## 重复、冲突与过时项

| 项 | 现象 | 处置建议 | 证据 |
| --- | --- | --- | --- |
| `manualOverride` 复用 | 四种覆写共用一个布尔，任一保存冻结能力自动刷新与过期清理 | 拆成"能力覆写"与"访问/参数覆写"两个标记，或按列判断 | `model-catalog-service.ts:406,414`；`utils/model-catalog.ts:314-317,323-325` |
| 重置语义 | 重置/清除覆写按行删除，连带丢掉访问策略与温度 | UI 文案改为"清除该模型全部覆写"，或分字段清除 | `model-catalog-service.ts:431-471`；`SystemModelsPage.tsx:350` |
| 能力入口 | 连接"默认能力"勾选 vs 标签 `vision`/`image_generation` | 合并到勾选，标签不再参与能力判定 | `SystemConnectionEditorParts.tsx:79-116`；`utils/providers.ts:77-84` |
| 能力层序 | 启发式覆盖供应商声明 | 改为 provider > heuristic > connection_default | `utils/model-catalog.ts:264-270` |
| `authType=session` | 无消费分支的伪选项 | 从 Select 移除 | `utils/providers.ts:111-134`；`schema.prisma:508` |
| `connectionType` | 无运行时分支 | 删除字段与 UI | `SystemConnectionEditorParts.tsx:55-68` |
| `prefixId` | 与 `displayName` 职责重叠，且参与解析 | 收敛为自动派生或迁移到显示身份 | `model-resolver-service.ts:96-100`；ADR-0034 |
| 个人设置导航 | 独立页 4 分区 vs 弹窗 5 项（含关于） | 单一来源：`personal-section.ts` 增 `about`，弹窗读同一表 | `settings-layout-client.tsx:56-61`；`nav.tsx:44-54`；`personal-section.ts:5-12` |
| 主题切换 | 个人资料卡三段按钮 + 用户菜单三项条目 | 保留用户菜单快捷切换，个人设置只做指向；或反之，二选一 | `PersonalPreferences.tsx:159-178`；`user-menu.tsx:89-101` |
| 强度与思考联动 | 思考关闭后强度仍可设但不生效 | 关闭时禁用强度入口并给原因 | `chat-request-builder.ts:645-652`；`model-selector-effort.tsx:13-20` |

## 有值无入口 / 有入口无值（缺口）

| 缺口 | 说明 | 证据 |
| --- | --- | --- |
| 连接组停用 | `ConnectionGroup.enable` 存在，API schema 与 UI 均无入口，只能整组删除 | `schema.prisma:507`；`api/connections.ts:28-40`；`SystemConnectionEditorParts.tsx` 全文无 enable |
| 分享标题编辑 | PATCH 支持 `title`，UI 只提交 `expiresInHours` | `api/shares.ts:21-24`；`ShareManagement.tsx:121` |
| `PersonalModels` 页面 | `settings-dialog.tsx:13` 注释引用不存在的模块 | `settings-dialog.tsx:13` |
| 个人页无"关于" | 独立页分区表少 `about`，弹窗有 | `personal-section.ts:5`；`nav.tsx:52` |
| 系统 OAuth 凭据 | `authType=system_oauth` 依赖进程环境变量，界面无法配置或验证其存在 | `utils/providers.ts:126-129` |

## 覆盖核对

- 本文件可配置字段：**36**（A6 + B1 + C5 + D4 + E15 + F5）
- 与 `field-inventory.json` 交集：**2** —— `modelAccessDefaultAnonymous`、`modelAccessDefaultUser`（D1、D2）
- 其余 34 项分别落在：`users` 列（5）、`chat_shares` 列（1）、`model_catalog.capabilities_json/meta_json`（7）、`connection_groups`/`connections` 列（15）、`chat_sessions` 列（3）、浏览器本地（4：theme、customHeaders、customBody、preferredModel 镜像）+ 请求级（1：customBody 与 F4 同键）
  - 逐项归属：A1 `users.username`、A2 `users.avatar_path`、A3 next-themes、A4 `users.contextEnabled`、A5 `users.personalPrompt`、A6 `users.preferredModel*`；B1 `chat_shares.expiresAt`；C1/C2 `capabilities_json`、C3/C4/C5 `meta_json`；D1/D2 `system_settings`、D3/D4 `meta_json.access_policy`；E1-E11 `connection_groups`、E12-E15 `connections`；F1/F2/F3 `chat_sessions`、F4/F5 localStorage
- 未展开（归属其他代理，避免重复计数）：技能与 MCP（task-3）、搜索/知识库/扩展（task-3）、系统级推理与网络参数（task-2）、用户与注册（task-2）

## 迁移牵连（供后续改动参考）

- 删除 `connectionType`：需同时清 `connection_groups.connectionType` 默认值、导出包 `schemaVersion: 2` 的字段（`connection-service.ts:159-171`）与前端 `SystemConnectionGroup` 类型；导入侧 `importConnectionSchema` 用 `.omit` 继承，需显式忽略旧字段而不是拒绝旧包。
- 移除 `authType=session`：存量若已有该值，请求会退化为无认证头（当前既不报错也不生效），迁移时应改写为 `bearer` 或 `none`，避免静默失败。
- 拆分 `manualOverride`：需要一次性回填判断（`capabilities_json` 非空 / `meta_json.access_policy|temperature|context_window|custom_max_output_tokens` 非空），否则首次刷新会把纯访问策略行误当能力覆写或反之。
- 合并标签能力入口：`tags` 仍是 `computeCapabilities` 输入，改动需同步 `utils/providers.ts` 与 `model-catalog-service.ts` 的导出/导入路径（导出含 tags，导入按 tags 回填）。
- 改能力层序：影响所有存量 `capabilities_json`（source 会从 `heuristic` 变为 `provider`），需一次重刷新并保留 `manual` 行不动。
