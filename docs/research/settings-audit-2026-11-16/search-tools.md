# 搜索 / 知识库 / 工具扩展 设置审计（main @ bb376960，2026-11-16）

只读代码审计：未改业务代码、未起服务、未读 `.env`/凭据/真实用户数据。默认值一律取**代码默认**（`SS-BE` 的 `formatted` 与 `CODEC` 的兜底），不是部署实值。

- 覆盖范围：`components/settings/pages/search-knowledge/**`、`tools-extensions/**`、`extensions/**`、`system-skills/**`、`PersonalSkills`，以及它们调用的 `system-mcp/**` 五个 tab 与 `features/skills`、`features/mcp` 接口。
- **字段计数：61 个 `SYSTEM_SETTINGS_FIELD_MAP` 字段**（总表 111 个的 61 个），另 66 项非字段控件（§4，按小节合计 9+25+14+13+5）。
- 61 的构成：47 可编辑且确有运行时消费（含 5 个搜索密钥）· 6 只读派生 · 3 无 UI 但后端可用 · 3 死配置 · 1 伪单值 · 1 断链。

---

## 0. 结论速览（按影响排序）

| # | 结论 | 决定性证据 |
|---|---|---|
| F1 | **"AI 自助安装"开关是断链开关，关不掉。** 前端 PUT 白名单没有 `extensionInstallToolEnable`（保存等于没发），后端 GET `formatted` 也不返回该键（读回永远是 codec 默认 `true`）；`install_extension` 实际恒按默认开启。 | `API-FE:153-166`（无该键）· `SS-BE:428-433,555-569`（formatted 无该键）· `CODEC:447-448`（默认 true）· `ATC:474-482,567-569`（消费方）· `EX:137-145` |
| F2 | **`python_tool_timeout_ms` / `max_output_chars` / `max_source_chars` 是死配置。** 聊天侧 Python 配置已改读 `WORKSPACE_*` 环境变量，`buildAgentPythonToolConfig` 的 `_sysMap` 参数被弃用，函数体写死 `enabled=true`。改这三项不影响任何执行。 | `ATC:319-360`（`BREAKING` 注释与 `WORKSPACE_RUN_TIMEOUT_MS`/`WORKSPACE_READ_MAX_CHARS`）· 全仓 `python_tool_*` 仅出现在 settings/api/codec（`SS-BE:434-454`、`API-BE:199-201`、`CODEC:412-438`） |
| F3 | **RAG 与知识库是"双开关、单依赖"：关掉 RAG 等于关掉知识库。** 知识库上传/检索都走 `getDocumentServices()`，而该单例只在 `rag_enabled=true` 且有 embedding 模型时创建；关 RAG 后上传直接 503。UI 两张卡互不提示，且 RAG 卡关闭时还会隐藏 Embedding 模型选择器。 | `RAGI:113-134`（未启用即 `setDocumentServices(null)`）· `KBA:251-253,304-306`（`RAG services not enabled` 503）· `KBS:402-410`（检索无服务即空）· `RAG:324,431`（`enabled ? … : undefined`） |
| F4 | **知识库三个开关只有前端门，服务端不校验。** `knowledgeBaseEnabled/AllowAnonymous/AllowUsers` 只在 `use-knowledge-base` 里过滤选择器；服务端实现这三个判定的 `getAvailableForChat` **没有任何调用者**，`GET /knowledge-bases`、`POST /knowledge-bases/search` 也不看这三项。 | `UKB:73-85,121-147` · `KBS:493-520`（唯一实现，全仓无调用）· `KBA:66-84,467` |
| F5 | **`webSearchParallelMergeStrategy` 是伪单值配置。** 后端解析器两个分支返回同一常量，codec 与 agent 配置同样恒为 `hybrid_score_v1`；页面还写明"融合策略固定为 …"，但每次保存都把它写库。 | `SS-BE:919-923` · `CODEC:392-395` · `ATC:210-218` · `WS:61,285,417` |
| F6 | **自动双语的两个键语义重复，且会被"单次调用查询扩展数=1"整体屏蔽。** `autoBilingualMode='off'` 与 `autoBilingual=false` 等价；双语扩展需要 `parallelMaxQueriesPerCall>1`，设为 1 时两个开关都无效。 | `WSH:203-213`（关闭或 mode 为 off 即不扩展）· `WSH:235`（`maxQueries > 1` 才加第二条查询）· `WS:389-405` |
| F7 | **`webSearchAutoReadBatchTimeoutMs` 后端与 ADR 都承诺可调，但设置页没有入口、后端 PUT 也没有前端提交路径。** 只能靠环境变量或直接打 snake_case API。 | `ADR-0046 §5` · `docs/deploy/web-retrieval.md:37` · `CON:124-128` · `ATC:279-286` · 全仓无 `patch.webSearchAutoReadBatchTimeoutMs` |
| F8 | **`webSearchScope` 的入口被"是否启用 Metaso"包住。** 只用 Tavily/Exa/Brave 的部署无法在 UI 里设置范围（含 `image`），而 scope 实际对所有引擎生效。 | `WS:421-442`（`hasMetasoEnabled &&`）· `ATC:168-171` · `WSH:259-268` |
| F9 | **"指定模型（暂不支持）"是伪选项。** 后端 `specified` 分支其实已实现，但页面没有 `titleSummaryConnectionId/ModelId` 选择器；选中后两 id 为 null，服务端静默落回"当前会话模型"。这两个 id 字段因此成为孤儿。 | `TS:130-142`（选项文案）· `TSS:81-102`（`specified && connectionId && modelId` 才走指定）· `TSR:59-67` |
| F10 | **实现常量仍被当成配置暴露/两端各写一份。** 知识库前端写死 `MAX_FILE_SIZE_MB=100`（后端实际上限由 `ragMaxFileSizeMb`=50 决定）、单批 20 个前端与后端各写一份；RAG 卡把 10 组取值范围在卡内硬编码，未引用后端 clamp。 | `KB:55-57,260` · `KBA:318-319` · `DOCSVC:185-187` · `FACT:76` · `RAG:63-74` vs `SS-BE:490-499` |
| F11 | **隐藏配置：`rag_ocr_*` 三个 DB 键只读不写。** 唯一读者是 RAG 初始化器，而 `rag_ocr_fallback_enabled` 永远无写入者 → 恒 false，且 initializer 会覆盖 `RAG_OCR_FALLBACK_ENABLED` 环境变量；命令与语言仍走环境变量兜底。 | `RAGI:99-101,192-194` · `FACT:81-83` · `DOCSVC:623` · 全仓无 `rag_ocr_*` 写入者 |
| F12 | **"Agent 工具最大迭代次数"挂在 Python 卡里，语义错位；0=无限且无二次确认。** | `PT:100-110` · `SCR:177-185` · `SU:19-30` |
| F13 | **只读派生字段与可写密钥混在一张卡。** `webSearchHasApiKey`（"任一引擎已配置"）被 composer 当作总门；引擎级 `hasApiKey*` 只是徽标。 | `SS-BE:300-301,373-379` · `CODEC:365-373` · `WS:495-504,611-795` · `CF:55-56` |
| F14 | **开了引擎但没配 Key 时不报错、不拦保存，运行时静默跳过该引擎。** 管理员会以为已开启。 | `WSH:270`（`withKeys` 过滤）· `ATC:545-549`（`enginesWithKeys.length>0` 才算生效）· `WS:228-234`（valid 不含 Key 检查） |
| F15 | **Skill 与 MCP 的绑定策略模型不对称。** Skill 绑定有 `Policy JSON`/`Overrides JSON` 裸文本域（无校验提示、`scopeId` 自由文本）；MCP 绑定只有 `enabled`，无策略字段。 | `SKB:139-168` · `system-mcp/bindings-tab.tsx:99-113` |

---

## 1. 逐项表（61 字段）

读法：**建议** ∈ 保留 / 收高级 / 合并 / 删除 / 修复 / 只读投影。**消费**列给出真实执行路径，`无`表示全仓无消费。

### A. 联网搜索（16 字段，`search-knowledge:web-search`）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| 联网搜索总开关 | `webSearchAgentEnable` | false | 卡主开关 | `ATC:122-125`；`agentWebSearchActive` 还需技能请求+有 Key | 保留 | `WS:139,264` · `CF:55-65` |
| 启用搜索引擎（多选） | `webSearchEnabledEngines` | `["tavily"]` | 复选组，≥1 | `ATC:127-130`；`WSH:259-278` 只保留有 Key 的 | 保留（补：勾选但无 Key 时保存前提示） | `WS:492-539` |
| 引擎优先顺序 | `webSearchEngineOrder` | 同 enabled | 上移/下移 | `ATC:132-139`；`WSH:262-269` | **合并**进 `EnabledEngines` 的数组顺序（三层各自 normalize 是重复结构的信号：`WS:79-88`、`SS-BE:283-286`、`CODEC:357-360`） | `WS:541-583` |
| 每次融合结果数 | `webSearchResultLimit` | 4 | 数字 1-10 | `ATC:153-160` clamp 1-10 | 保留 | `WS:585-596` |
| 域名白名单 | `webSearchDomainFilter` | `[]` | 文本域，每行一个 | `ATC:162-164`；引擎原生参数/Brave `site:`/Metaso 本地过滤（`CONTEXT:70`） | 保留 | `WS:598-609` |
| 默认搜索范围 | `webSearchScope` | `"webpage"` | Select 7 值，**仅 Metaso 启用时渲染** | `ATC:168-171` → `WSH:259-268`（影响所有引擎，含 image） | **修复**：条件改为"至少一个引擎启用"，并标注 image 会关自动阅读 | `WS:421-442` |
| 召回增强（摘要参与召回） | `webSearchIncludeSummary` | false | 开关，仅 Metaso/Exa | `WSU:644,735,1099` | 保留 | `WS:443-455` |
| 获取网页原文 | `webSearchIncludeRaw` | false | 开关，仅 Tavily/Exa/Metaso/DeepSeek | `WSU:426,650,690-691,731,855`；自动阅读/DeepSeek 需要时会强制开启 | 保留（文案补"自动阅读会强制取正文"） | `WS:459-476` |
| 并行引擎上限 | `webSearchParallelMaxEngines` | 3 | 数字 1-5 | `ATC:183-190`；`WSH:271-277` | 收高级 | `WS:346-356` |
| 单次调用查询扩展数 | `webSearchParallelMaxQueriesPerCall` | 2 | 数字 1-3 | `ATC:192-199`；是双语的硬前置 | 收高级 | `WS:357-368` |
| 并行检索超时 | `webSearchParallelTimeoutMs` | 12000 | 数字 1000-120000 | `ATC:201-208` | 收高级 | `WS:369-380` |
| 融合策略 | `webSearchParallelMergeStrategy` | `"hybrid_score_v1"` | 仅静态说明文字，保存时写入 | **无多值行为**：`SS-BE:919-923`、`CODEC:392-395`、`ATC:217-218` 三层恒等 | **删除**：改代码常量，停止持久化；否则永远是一条噪声写入 | `WS:61,285,417` |
| 自动双语检索 | `webSearchAutoBilingual` | true | 开关 | `ATC:220-223` → `WSH:203-232` | **合并**：与 mode 重复，保留 mode 三值即可 | `WS:384-389` |
| 双语扩展策略 | `webSearchAutoBilingualMode` | `"conditional"` | Select off/conditional/always | `WSH:209-213` 真实三态 | 保留（合并后由它单独承载） | `WS:391-405` |
| 自动网页读取并发 | `webSearchAutoReadParallelism` | 2 | 数字 1-4 | `ATC:251-258` | 收高级 | `WS:406-418` |
| 自动阅读批次总时限 | `webSearchAutoReadBatchTimeoutMs` | 18000 | **无控件** | `ATC:279-286`；ADR-0046 §5 要求独立截止线 | 收高级（补数字输入），或彻底 env 化并删字段——现状是"文档说能改、界面没有" | `docs/deploy/web-retrieval.md:37` · `CON:124-128` |

### B. 搜索密钥与只读投影（12 字段，同卡）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| DeepSeek Fetch 付费回退 | `webSearchDeepseekFetchEnable` | false | 开关（卡内独立区块） | `ATC:422`（URL Reader）与 `ATC:299`；仅本地读页失败时回退，`CONTEXT:66` | 保留（位置宜迁到"网页读取"语境，现挂在搜索卡易误解） | `WS:798-818` |
| Tavily API Key | `webSearchApiKeyTavily` | `""` | password + 清除 | `ATC:141-151`；`SS-BE:724` | 保留 | `WS:611-646` |
| Brave API Key | `webSearchApiKeyBrave` | `""` | 同上 | 同上 | 保留 | `WS:648-682` |
| Metaso API Key | `webSearchApiKeyMetaso` | `""` | 同上 | 同上 | 保留 | `WS:684-718` |
| Exa API Key | `webSearchApiKeyExa` | `""` | 同上 | 同上 | 保留 | `WS:720-754` |
| DeepSeek API Key | `webSearchApiKeyDeepseek` | `""` | password + 清除（走 Secret Vault） | `SS-BE:575-578` 写入密钥库；`ATC:144-146` 读取 | 保留 | `WS:756-795` |
| 已配置任意搜索 Key | `webSearchHasApiKey` | 派生 | 只读（composer 总门） | `SS-BE:300-301`；`CF:55-56` | 只读投影（不得作为可写设置） | `CODEC:365,372-373` |
| Tavily 已配置 | `webSearchHasApiKeyTavily` | 派生 | 徽标 "已配置 Key" | `SS-BE:287-289,373` | 只读投影 | `WS:495-504` |
| Brave 已配置 | `webSearchHasApiKeyBrave` | 派生 | 同上 | `SS-BE:290-292` | 只读投影 | 同上 |
| Metaso 已配置 | `webSearchHasApiKeyMetaso` | 派生 | 同上 | `SS-BE:293-295` | 只读投影 | 同上 |
| Exa 已配置 | `webSearchHasApiKeyExa` | 派生 | 同上 | `SS-BE:296-298` | 只读投影 | 同上 |
| DeepSeek 已配置 | `webSearchHasApiKeyDeepseek` | 派生 | 同上 | `SS-BE:299`（密钥库探测） | 只读投影 | 同上 |

### C. RAG 文档解析（13 字段，`search-knowledge:rag`）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| RAG 总开关 | `ragEnabled` | false | 卡主开关 | `RAGI:113-119`：决定 `documentServices` 是否存在（**同时是知识库的硬前置**，见 F3） | 保留；文案必须写明"知识库依赖此项" | `RAG:243-244` |
| Embedding 连接 | `ragEmbeddingConnectionId` | null | 模型选择器（连接+模型成对） | `RAGI:122-149`（缺连接/模型直接失败） | 保留 | `RAG:433-489` |
| Embedding 模型 | `ragEmbeddingModelId` | null | 同上 | `RAGI:180` | 保留（修复：清空连接时不重置 model，`API-FE:196-199` 只接受 string，导致脏值） | `CODEC:120,616` |
| 批量大小 | `ragEmbeddingBatchSize` | 1 | 数字 1-128 | `RAGI:163-166,183` | 收高级 | `RAG:328-348` |
| 并发数 | `ragEmbeddingConcurrency` | 1 | 数字 1-16 | `RAGI:167-170,184` | 收高级 | 同上 |
| Top K | `ragTopK` | 5 | 数字 1-20 | `RAGI:197` | 保留 | `RAG:498-506` |
| 相关性阈值 | `ragRelevanceThreshold` | 0.3 | 数字 0-1 | `RAGI:198` | 保留 | `RAG:508-516` |
| 上下文 Token 限制 | `ragMaxContextTokens` | 4000 | 数字 500-32000 | `RAGI:199` | 保留 | `RAG:518-526` |
| 分块大小 | `ragChunkSize` | 1500 | 数字 100-8000 | `RAGI:188` | 收高级 | `RAG:354-362` |
| 分块重叠 | `ragChunkOverlap` | 100 | 数字 0-1000 | `RAGI:189` | 收高级 | `RAG:364-372` |
| 最大文件大小 (MB) | `ragMaxFileSizeMb` | 50 | 数字 1-200 | `RAGI:187` → `DOCSVC:185-187` 真实拦截 | 保留；**前端知识库卡片必须读它**（现写死 100，F10） | `RAG:374-382` |
| 最大页数 | `ragMaxPages` | 200 | 数字 10-1000 | `RAGI:191` | 保留 | `RAG:384-392` |
| 文档保留天数 | `ragRetentionDays` | 30 | 数字 1-365 | `RAGI:190` → 清理调度器 | 保留（属数据保留语义，建议与 `data-maintenance` 保留策略同屏对照） | `RAG:396-406` |

### D. 知识库（3 字段，`search-knowledge:knowledge-base`）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| 知识库总开关 | `knowledgeBaseEnabled` | false | 卡主开关 | **仅前端门**：`UKB:73,78,85`；服务端无校验（F4） | 保留 + 补服务端校验；或在文案里标明"当前仅控制入口可见性" | `KB:136,168` |
| 允许匿名用户使用 | `knowledgeBaseAllowAnonymous` | false | 开关（启用后可见） | 仅前端门 `UKB:80` | 保留 + 补服务端 | `KB:485-491` |
| 允许注册用户使用 | `knowledgeBaseAllowUsers` | true | 开关 | 仅前端门 `UKB:81` | 保留 + 补服务端 | `KB:492-498` |

### E. 内置工具 / Python 与 Agent 迭代（5 字段，`extensions:python-tools`）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| Python 工具开关 | `pythonToolEnable` | false | 卡主开关 | 前端能力门 `CF:58-70,118-129`；**后端不校验**（`ATC:325` 恒 enabled） | 保留；同时补后端门，避免只靠客户端 | `PT:37,67-68` · `OV:107` |
| 超时时间 | `pythonToolTimeoutMs` | 8000 | 数字 1000-60000 | **无**（改用 `WORKSPACE_RUN_TIMEOUT_MS`=120000） | **删除** | `PT:128-140` · `ATC:327-334` |
| stdout 截断字符数 | `pythonToolMaxOutputChars` | 4000 | 数字 256-20000 | **无**（改用 `WORKSPACE_READ_MAX_CHARS`） | **删除** | `PT:141-152` · `ATC:336-343` |
| 代码长度限制 | `pythonToolMaxSourceChars` | 4000 | 数字 256-20000 | **无**（同上） | **删除** | `PT:153-164` · `ATC:345-352` |
| Agent 工具最大迭代次数 | `agentMaxToolIterations` | 4 | 数字 0-20，0=无限 | `SCR:177-185`；`SU:19-30`（0→`Infinity`）；`agent-web-search-response.ts:658` | 收高级 + **迁出 Python 卡**（全局循环上限不属于 Python 工具）；0 建议二次确认 | `PT:100-110` |

### F. 标题智能总结（5 字段，`extensions:title-summary`）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| 启用智能标题 | `titleSummaryEnabled` | false | 开关（实验性徽标） | `TSR:59-71`（关闭直接 400）；客户端 `stream-title` 触发 | 保留 | `TS:85-99` |
| 标题最大长度 | `titleSummaryMaxLength` | 20 | 数字 5-50（未启用时禁用） | `TSS:105-110,205-207` | 保留 | `TS:101-123` |
| 模型来源 | `titleSummaryModelSource` | `"current"` | Select 两项，第二项标注"暂不支持" | `TSS:81-102`：`specified` 需同时有 connectionId+modelId，否则静默落回当前模型 | **修复**：删掉伪选项，或补齐选择器 | `TS:130-142` |
| 标题模型连接 | `titleSummaryConnectionId` | null | **无控件** | `TSR:65` → `TSS:81-89` | 收高级（配选择器）或随伪选项一并删除 | `CODEC:509-513` |
| 标题模型 ID | `titleSummaryModelId` | null | **无控件** | `TSR:66` → `TSS:81-89` | 同上 | `CODEC:514-518` |

### G. 模型大乱斗（4 字段，`extensions:battle`）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| 允许匿名使用 | `battleAllowAnonymous` | true | 开关 | `BS:1402,1753` 读 `getBattlePolicy` | 保留 | `BA:92-101` |
| 匿名每日次数 | `battleAnonymousDailyQuota` | 20 | 数字 ≥0（0=当天不可用） | 同上 | 保留 | `BA:103-118` |
| 允许注册用户使用 | `battleAllowUsers` | true | 开关 | 同上 | 保留 | `BA:120-129` |
| 注册用户每日次数 | `battleUserDailyQuota` | 200 | 数字 ≥0 | 同上 | 保留 | `BA:131-146` |

> `battleRetentionDays`（乱斗记录保留）属"数据与维护"范围，由另一份报告覆盖，本表不计数。

### H. 能力扩展三总闸（3 字段）

| 中文名 | key | 默认 | 控件 | 真实消费 | 建议 | 证据 |
|---|---|---|---|---|---|---|
| MCP 全局总闸 | `mcpGlobalEnabled` | true | MCP 段页头开关 | `MCPS:49,95-102`：`false` 时 403 硬闸（ADR-0010 最高优先级） | 保留 | `MS:70-95` · `SS:8-11` |
| 动态 Skill Runtime | `chatDynamicSkillRuntimeEnabled` | false | Skill 段页头开关 | `ATC:558-564` → `dynamicSkillRequested` | 保留 | `SKS:73-87` |
| AI 自助安装（install_extension） | `extensionInstallToolEnable` | true | 页头开关 | 后端读 `ATC:474-482`，但 **GET 不返回 / 前端不提交** → 断链（F1） | **修复**（补 GET 字段 + patch 白名单），否则删除开关并把默认值写成常量 | `EX:137-145` · `SS-BE:428-433` · `API-FE:153-166` |

---

## 2. 建议分布

| 动作 | 数量 | 明细 |
|---|---|---|
| 保留 | 34 | 搜索 12（含 5 密钥）· RAG 9 · 知识库 3 · Python 开关 1 · 标题 2 · 乱斗 4 · MCP/Skill 总闸 2 |
| 收高级 | 12 | 并行三参数、自动阅读并发与批次时限、Embedding 批量/并发、分块大小/重叠、Agent 迭代上限、标题连接/模型 ID |
| 合并 | 2 | `webSearchEngineOrder`→启用引擎顺序；`webSearchAutoBilingual`→双语策略 |
| 删除 | 4 | `webSearchParallelMergeStrategy`、`pythonToolTimeoutMs`、`pythonToolMaxOutputChars`、`pythonToolMaxSourceChars` |
| 修复 | 3 | `webSearchScope`（入口条件）、`titleSummaryModelSource`（伪选项）、`extensionInstallToolEnable`（断链） |
| 只读投影 | 6 | `webSearchHasApiKey` + 5 个引擎级 hasApiKey |

---

## 3. Lead 指定的三项核查结论

1. **`webSearchAutoBilingual` / `webSearchAutoBilingualMode`：仍有多种真实行为，但两者语义重叠且可被另一项钳制。**
   - 真实分支：`shouldExpandBilingual`（`WSH:203-213`）——`!enabled || mode==='off'` 不扩展；`always` 必扩展；`conditional` 只在查询语言 unknown 或命中 `BILINGUAL_TOPIC_RE` 时扩展。
   - 重叠：`autoBilingual=false` 与 `mode='off'` 完全等价，是两个键表达一件事。
   - 钳制：`buildBilingualQueries` 第 235 行要求 `maxQueries > 1`；若 `webSearchParallelMaxQueriesPerCall=1`，两个键都不产生任何行为。
   - 结论：保留 mode 三值、把 bool 合并进去；文档/UI 需说明与"查询扩展数"的依赖。
2. **`webSearchIncludeRaw` / `webSearchIncludeSummary`：有真实、按引擎分化的行为，但不是绝对开关。**
   - `includeRawContent` 只在支持正文的引擎与 `scope=webpage` 时生效（`WSU:426,650,690-691`，`CONTEXT:70`）；UI 也按引擎显隐（`WS:57,459-476`）。
   - 自动阅读需要正文时会**无视该开关强制取正文**（`WSU:426`、`731`、`855`）；battle/skill 覆写也能改写它（`battle-executor.ts:151-154`、`web-search-skill-overrides.ts:144-150`）。
   - `includeSummary` 只对 Metaso/Exa 的摘要字段生效（`WSU:644,735`），UI 同样按引擎显隐（`WS:59,443-455`）。
   - 结论：两者都保留；文案应写成"默认值，自动阅读与绑定覆写可覆盖"。
3. **`webSearchParallelMergeStrategy`：没有任何第二种行为。** 三层解析（`SS-BE:919-923`、`CODEC:392-395`、`ATC:217-218`）都是"无论输入是什么，返回 `hybrid_score_v1`"；页面自己也写着"融合策略固定为 …"（`WS:417`）。这是"实现常量被当成配置持久化"，建议删除字段，只留代码常量与说明。

**RAG 与知识库的重复 enable**：确认是"双开关单依赖"。`rag_enabled` 是真正的能力开关（决定 `documentServices` 是否创建）；`knowledge_base_enabled` 只控制前端入口可见。二者不可互换：
- 关 `ragEnabled`：知识库上传 503、检索空、文档管理弹框仍能打开但上传必败；
- 开 `ragEnabled` + 关 `knowledgeBaseEnabled`：UI 隐藏入口，但 `GET /knowledge-bases`、`POST /knowledge-bases/search` 仍返回数据（服务端未校验）。
建议：`ragEnabled` 是唯一能力真源；`knowledgeBaseEnabled` 改为"知识库入口开关"并在两卡互相标注依赖，同时补服务端校验（或把三项 KB 判定真正接到 `getAvailableForChat` 的调用点上）。

---

## 4. 非字段控件（66 项，不计入 61）

### 4.1 Python 运行时管理（9 项：5 配置 + 4 操作；`extensions:python-runtime`，独立 API，不走 `SYSTEM_SETTINGS_FIELD_MAP`）

| 控件 | 存储 | 默认 | 消费 | 建议 | 证据 |
|---|---|---|---|---|---|
| 主索引 `indexUrl` | `PUT /settings/python-runtime/indexes` | 空（placeholder pypi） | pip 安装参数 | 保留 | `PR:267-274` · `API-BE:339-361` |
| 额外索引 `extraIndexUrls` | 同上 | `[]` | pip `--extra-index-url` | 保留 | `PR:275-284` |
| trusted-host `trustedHosts` | 同上 | `[]` | pip `--trusted-host` | 保留（安全敏感，建议标注风险） | `PR:285-293` |
| 激活 Skill 时自动装 `autoInstallOnActivate` | 同上 | true | 依赖构建 | 保留 | `PR:295-304` |
| 缺库自动安装 `autoInstallOnMissing` | 同上 | true | 运行期补装（仅登录用户） | 保留 | `PR:305-314` |
| 安装依赖 / 卸载包 / Reconcile / 来源筛选 | API | — | 运行时维护 | 保留（这是运维动作，不是设置项，勿混入字段表） | `PR:322-364,379-457` |

> 这 5 项是真实配置，但**不在 111 字段里**——如果总表要覆盖"所有可调项"，应作为独立小节，不要误并入 `SYSTEM_SETTINGS`。

### 4.2 MCP（25 项：安装模板 12 + 连接 5 + 凭据 2 + 工具 2 + 绑定 4；`extensions:mcp-*`）

| 控件 | 建议 | 证据 |
|---|---|---|
| 安装模板：`namespaceKey` `name` `description` `sourceType`(remote/local_package) `transport`(streamable_http/sse/stdio) `endpoint` `command` `argsJson` `envJson` `sourceUrl` `sourceKey` `registrySource` | 保留（`argsJson/envJson` 为裸 JSON，建议加校验与"这是执行参数"的提示） | `installations-tab.tsx:117-138` |
| 连接：`installationId` `name` `configJson` `secretVaultId` `enabled` | 保留；`configJson` 建议提供键值编辑器 | `connections-tab.tsx:196-222` |
| 凭据：新建/编辑密钥（值只写不读） | 保留（ADR-0011 共享密钥库） | `secrets-tab.tsx` |
| 工具：搜索、固定/取消固定（Pinned Tool 直暴露） | 保留（ADR-0013 渐进发现） | `tools-tab.tsx:48-57,100-104` |
| 绑定：`connectionId` `scopeType`(system/user/session/battle_model) `scopeId` `enabled` | 保留；**建议补 policy 字段**（与 Skill 绑定对齐，F15） | `bindings-tab.tsx:99-113` |

### 4.3 Skill（14 项：安装 2 + 审批 2 + 版本 3 + 绑定 5 + 策略 JSON 2；`extensions:skill-*`）

| 控件 | 建议 | 证据 |
|---|---|---|
| 安装：GitHub `source` + 可选 `token` | 保留（ADR-0003/0007；token 仅私有库） | `SkillInstallSection.tsx:28-60` · `skill-install-panel.tsx:18-50` |
| 待审批：批准/拒绝 | 保留（ADR-0004 能力授权的运行时确认） | `SkillApprovalsSection.tsx:63-80` |
| 版本：批准版本 / 激活并设默认 / 卸载 Skill | 保留（ADR-0008 会话固定版本） | `SkillVersionSection.tsx:108-126` |
| 绑定：`skillId` `versionId`(含 default) `scopeType` `scopeId` `enabled` | 保留 | `SkillBindingsSection.tsx:74-168` |
| 绑定 `Policy JSON` / `Overrides JSON` | 保留但建议**结构化编辑器 + schema 校验**：现为裸文本域、无校验、失败只能看到后端错误；`scopeId` 亦为自由文本 | `SkillBindingsSection.tsx:139-158` |

### 4.4 知识库文档与 RAG 文档管理（13 项：建库 3 + 知识库文档操作 5 + RAG 文档操作 5）

| 控件 | 建议 | 证据 |
|---|---|---|
| 新建知识库：`name` `description`（`isPublic` 固定 true） | 保留；`isPublic` 写死，若将来要私有库需前置设计 | `KB:182-213,622-657` |
| 上传文档（多选，≤100MB/文件、≤20/批） | **修复**：上限应读 `ragMaxFileSizeMb`；批量 20 前后端各写一份 | `KB:55-64,237-269` · `KBA:318-319` |
| 批量移除 / 单删 / 刷新统计 / 删除知识库 | 保留（删除会级联清文档、向量与 VACUUM） | `KB:380-464,215-235` |
| RAG 文档管理弹框：搜索、状态筛选、批量删除、单删、刷新 | 保留（运维动作） | `doc-manage-dialog.tsx:113-170,229-236` · `RAG:77-179` |

### 4.5 PersonalSkills（5 项：视图切换、搜索、来源筛选、安装、卸载；无 settings key）

| 控件 | 建议 | 证据 |
|---|---|---|
| 商店/已安装 视图切换、搜索、来源筛选 | 保留 | `PersonalSkills.tsx:176-228` |
| 安装（商店项，受许可证状态与 `installable` 限制）/ 卸载 | 保留（安装后仅当前账号可用） | `PersonalSkills.tsx:118-160,246-343` |

### 4.6 只读展示（不是设置，别误删）

`extensions` 总览三张状态卡（MCP/Skill/内置工具，读 `mcpGlobalEnabled`/`chatDynamicSkillRuntimeEnabled`/`pythonToolEnable`）、两行待处理清单、扩展页头两个跳转按钮（`OV:80-149` · `EX:146-162`）。

---

## 5. 迁移牵连（按建议动作）

**删除 4 项**
- `webSearchParallelMergeStrategy`：删字段要同步改 4 处——`CON` 映射、`SS-BE:302-304,404,730,919-923`（含 stringFields 的写库项）、`CODEC:392-395,581`、`ATC:210-218`（改成常量）；页面 `WS:61,285,417` 的写入与说明文字一并删。**无需数据迁移**（历史值不再被读）。
- `pythonToolTimeoutMs / MaxOutputChars / MaxSourceChars`：删字段要改 `CON`、`SS-BE:434-454,645-647`、`API-BE:199-201`、`CODEC:412-438`、`API-FE:158-161`、`PT:128-164`；`PT:17-19` 的范围常量随之删除。若想保留"可调"能力，正确做法是把 `WORKSPACE_RUN_TIMEOUT_MS`/`WORKSPACE_READ_MAX_CHARS` 提升为设置项（新能力，需 ADR），而不是复活旧键。

**合并 2 项**
- `webSearchEngineOrder` → 由 `webSearchEnabledEngines` 数组顺序承载：删 `WS:79-88,246-258,541-583`、`SS-BE:279-286,370,746-748`、`CODEC:353-360`、`ATC:132-139`、`WSH:262-269`（保留去重+过滤）；需一次性把已有 order 折进 enabled 数组（可逆、无表结构变更）。
- `webSearchAutoBilingual` → `webSearchAutoBilingualMode`：删 bool 要改 `WS:386-389`、`SS-BE:405,679`、`CODEC:396`、`ATC:220-223,304`、`WSH:207,231`；`off` 承接"关闭"语义。

**修复 3 项**
- `extensionInstallToolEnable`：后端 `formatted` 增加 `extension_install_tool_enable`（`SS-BE:428-433` 一带），前端 `API-FE` 增加 `patch.extensionInstallToolEnable`；否则开关只能靠 env。**注意**：修复前该能力对部署方实际是"恒开"，修复后首次保存会真正生效，需在发布说明里提示。
- `titleSummaryModelSource`：要么删除 `specified` 选项（`TS:139-141`），要么补 `connectionId/modelId` 选择器并放开 `CODEC:509-518` 的读取；删除时同步清 `titleSummaryConnectionId/ModelId` 两个孤儿字段。
- `webSearchScope`：把 `WS:421` 的条件从 `hasMetasoEnabled` 改为"至少一个引擎启用"，并在 `image` 选项旁说明会跳过自动阅读（`CONTEXT:69`）。

**补服务端校验（知识库 3 项）**：把 `KBS:493-520` 接到 `KBA:66-84`（列表）与 `KBA:467`（搜索）、`KBA:244/297`（上传）上；否则"关闭"只对 Web 客户端有效。

**隐藏配置**：`rag_ocr_fallback_enabled/command/language` 若要保留，应纳入 `CON`+`SS-BE`+`API-BE` 正式字段（并修正 initializer 覆盖 env 的行为）；不纳入就删掉 DB 读取路径（`RAGI:99-101,192-194`），只留环境变量。

---

## 6. 明确不要删（避免误判）

- `ragRetentionDays`、`ragMaxFileSizeMb`、`ragMaxPages`：是存储与资源边界，不是"模型变强后可省"的调参项。
- `ragEnabled` / `ragEmbeddingConnectionId` / `ragEmbeddingModelId`：RAG 与知识库的唯一真源，删掉会让知识库彻底不可用。
- `mcpGlobalEnabled`：ADR-0010 的硬闸，属于安全边界而非体验开关。
- `knowledgeBaseAllowAnonymous/AllowUsers`：当前虽只在前端生效，但语义是访问控制，应**修实现**而不是删开关。
- `webSearchApiKey*`：凭据类设置，删除等于丢连接能力（DeepSeek 还绑 Secret Vault）。
- `battleAllow*`/`*DailyQuota`：真实配额与准入，消费在 `battle-service`。
- 各卡的"清除 Key"按钮：删除凭据的唯一入口，不是可省的小动作。

---

## 7. 未验证与边界

- 未运行应用/接口，所有"消费"结论来自静态阅读；`documentServices` 单例的生命周期（`index.ts:52` 启动即 reload、`API-BE:292-297` 保存即 reload）已按代码阅读确认，但未做运行时复现 503。
- 未核对 1Panel/Docker 部署是否设置了 `WEB_SEARCH_*`、`WORKSPACE_*`、`RAG_OCR_*` 等环境变量；本报告默认值均为代码默认。
- `system-mcp/secrets-tab.tsx`、`connection-credentials.tsx` 只做控件级核对，未展开密钥存储细节（避免触碰凭据语义）。
- `system-settings-registry-overview`（概览页完成度）与本报告字段无强绑定，未纳入。
- `battleRetentionDays`、`taskTrace*`、`chat_max_concurrent_streams` 等属其他代理范围，本报告仅在必要处交叉引用。

---

## 8. 证据索引（缩写 → 路径）

| 缩写 | 路径 |
|---|---|
| WS | `packages/frontend/src/components/settings/pages/search-knowledge/web-search-card.tsx` |
| RAG | `.../search-knowledge/rag-card.tsx` |
| KB | `.../search-knowledge/knowledge-base-card.tsx` |
| PT | `.../tools-extensions/python-tools-card.tsx` |
| PR | `.../tools-extensions/python-runtime-card.tsx` |
| TS | `.../tools-extensions/title-summary-card.tsx` |
| BA | `.../tools-extensions/battle-card.tsx` |
| EX | `packages/frontend/src/components/settings/pages/extensions/ExtensionsPage.tsx` |
| MS / SKS / OV / ES | `.../extensions/sections/{mcp-section,skill-section,overview-section}.tsx` · `.../extensions/extensions-sections.ts` |
| SS | `.../extensions/sections/section-switch.tsx` |
| SKB | `packages/frontend/src/components/settings/pages/system-skills/SkillBindingsSection.tsx` |
| UKB | `packages/frontend/src/hooks/use-knowledge-base.ts` |
| CF | `packages/frontend/src/features/chat/composer/use-composer-feature-flags.ts` |
| API-FE | `packages/frontend/src/api/settings.ts` |
| CON / CODEC | `packages/shared/src/settings-contract.ts` · `packages/shared/src/settings-codec.ts` |
| SS-BE | `packages/backend/src/services/settings/settings-service.ts` |
| API-BE | `packages/backend/src/api/settings.ts` |
| ATC | `packages/backend/src/agent-runtime/agent-tool-config.ts` |
| WSH / WSU | `packages/backend/src/modules/chat/tool-handlers/web-search-handler.ts` · `packages/backend/src/utils/web-search.ts` |
| RAGI | `packages/backend/src/services/rag-initializer.ts` |
| KBS / KBA | `packages/backend/src/services/knowledge-base/knowledge-base-service.ts` · `packages/backend/src/api/knowledge-bases.ts` |
| DOCSVC / FACT | `packages/backend/src/services/document/document-service.ts` · `packages/backend/src/services/document-services-factory.ts` |
| SCR / SU | `packages/backend/src/services/stream/stream-config-resolver.ts` · `packages/backend/src/agent-runtime/stream-utils.ts` |
| TSR / TSS | `packages/backend/src/modules/chat/routes/title-summary.ts` · `packages/backend/src/modules/chat/services/title-summary-service.ts` |
| MCPS / BS | `packages/backend/src/services/mcp/mcp-service.ts` · `packages/backend/src/services/battle/battle-service.ts` |

参考文档：`CONTEXT.md:63-79`（搜索与证据）、`CONTEXT:130-138`（设置与能力扩展）、`CONTEXT:158-190`（Skill）、`CONTEXT:192-223`（MCP/Extension）；ADR-0004、0008、0010、0013、0016、0038、0046。
