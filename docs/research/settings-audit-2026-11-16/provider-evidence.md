# 现代模型参数与内置工具：官方文档证据（2026-11-16）

本文件是 AIChat 设置精简审计的**厂商侧证据底稿**。只记录可回溯到官方一手来源的观测，以及明确标注的产品推断；不写业务代码结论之外的实现建议清单（那属于审计主报告）。

- 观测日期：2026-11-16（Asia/Singapore）；本文件为第 2 版，已按代码复核收口：注入优先级与发送条件、默认输出上限口径、usage 总量口径、标签解析与其余环节的分层、托管容器与本地数据的边界
- 代码基线：`main`，worktree `settings-users-main`
- 取证方式：只读代码 + 联网抓取官方文档；未做任何模型付费调用，未读取或使用任何 API Key
- 抓取通道限制：本环境的 web 抓取代理只对部分域名放行。**可直连**：`platform.claude.com`（含 `.md` 源文）、`api-docs.deepseek.com`、`github.com`（官方 SDK／proto 源文件，纯文本返回）。**被拦**：`platform.openai.com`、`openai.com`、`developers.openai.com`、`ai.google.dev`、`cloud.google.com`、`docs.anthropic.com`、`raw.githubusercontent.com`，均返回代理层 404 或超时。因此 OpenAI／Gemini 的**参数契约**取自官方仓库里由 OpenAPI／proto 生成的类型定义（等价一手），而 **per-model 支持矩阵**只能记为覆盖缺口。

## 结论速览

| 审计主题 | 官方事实（可引用） | 对 AIChat 的判定 |
| --- | --- | --- |
| reasoning effort | 四家枚举互不相同且有模型级差异：OpenAI `none/minimal/low/medium/high/xhigh/max` 且"并非所有推理模型支持每个值"；Anthropic `output_config.effort` = `low/medium/high/xhigh/max`，默认值随模型不同；Gemini 是 `thinking_budget`(0/-1) 或 `thinking_level`(MINIMAL..XHIGH) 两套机制；DeepSeek `low/high/max`（其余值静默映射） | 单一全局值的语义不成立，应能按模型/连接配置；全局值只是兜底，且只在 `reasoningEnabled && effort` 同时成立时才发送；**有效强度没有经过模型能力校验**，可能与模型支持面不符（返回 400 或被忽略） |
| 旧 `thinking.budget_tokens` | Anthropic 已标记 legacy，**Claude 4.7 及以后直接 400**；最小值 1024，必须小于 `max_tokens` | 现有 effort→budget 固定映射表只对旧模型成立，需按模型门控 |
| temperature / top_p | DeepSeek 思考模式**忽略 temperature、不报错**；`top_p` 在 deepseek-flash 仅思考模式生效且夹到 0.95–1.0，在 deepseek-v4-pro 思考模式被忽略 | 仍有用，但不能全局假设生效；应从全局默认降为模型级 |
| max output tokens | DeepSeek `max_tokens` 1–393216，默认 8K（非思考）/64K（思考）/128K（effort=max）；OpenAI `max_completion_tokens` 含 reasoning tokens；Anthropic `max_tokens` 是含 thinking 的硬上限 | 全局固定「32000」在多家失真；正确形态是「自动／按模型协议解析」——**留空并不等于交厂商**：Anthropic 适配层在省略时仍补 4096（见下方代码事实） |
| 结构化 reasoning | Anthropic：thinking block + 加密 `signature` 必须原样回传，`display` 默认 `omitted`；OpenAI：只有 `summary` 摘要与 `reasoning_tokens`；Gemini：`include_thoughts`；DeepSeek：`reasoning_content`，**带 tools 时必须回传否则 400** | 用 `think` 标签正则解析官方四家已是兜底手段，不是主路径 |
| token usage | OpenAI `cached_tokens`/`cache_write_tokens`/`reasoning_tokens`；DeepSeek `prompt_cache_hit_tokens`+`prompt_cache_miss_tokens`；Gemini `thoughts_token_count`/`cached_content_token_count`；Anthropic `output_tokens_details.thinking_tokens` | 缺明细**不等于低估总成本**：总量字段可能已包含 reasoning tokens；影响的是分项可解释性与成本归因，须先核对总量口径 |
| 上下文压缩 | Anthropic 明确「server-side compaction 是主要策略」，另有 `clear_tool_uses`/`clear_thinking`；清 thinking 会使缓存失效 | 自建压缩仍需保留（跨厂商/可控），但应允许厂商侧优先 |
| 内置 web search / code execution | Anthropic/OpenAI/Gemini 是**托管工具**（服务端执行、容器/网络策略、数据留存条款不同）；DeepSeek 的搜索是**独立应用 API**，不是模型内置 tool | 不能等价替代项目自托管执行与外部搜索：托管容器默认不直接触达本地数据，需经单独集成上传；且 DeepSeek 连接无内置 tool。定位是按连接可选 |

## 来源清单（10 条，全部一手）

抓取时间均为 2026-11-16。每条给出**实际观测到的内容**，而不是搜索摘要。

1. **Anthropic — Effort** `https://platform.claude.com/docs/en/build-with-claude/effort.md`
   观测：`output_config.effort`；等级 `max/xhigh/high/medium/low`；"Most Claude models default to high effort; Claude Opus 5.5 and Claude Haiku 5.5 default to medium"；"Setting effort to the model's default … produces exactly the same behavior as omitting the effort parameter entirely"；effort 影响**全部**输出 token（文本、工具调用、thinking）；"Effort is a behavioral signal, not a strict token budget"；"Not every model that supports `max` supports `xhigh`"；示例请求用 `anthropic-version: 2026-10-21`。

2. **Anthropic — Extended thinking（legacy）** `https://platform.claude.com/docs/en/build-with-claude/extended-thinking.md`
   观测：`thinking.type: "enabled"` + `budget_tokens` 已 **deprecated**；"Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error"；`budget_tokens` 最小 1024，且必须小于 `max_tokens`（interleaved 手动模式为例外）；"`max_tokens` remains the hard ceiling on total output"；用量字段 `usage.output_tokens_details.thinking_tokens`（流式只在最后 `message_delta`）；**改 `budget_tokens` 会让 prompt cache 失效**（budget 值会被渲染进 prompt）。

3. **Anthropic — Thinking（现行模型 × thinking 配置矩阵）** `https://platform.claude.com/docs/en/build-with-claude/thinking.md`
   观测：逐模型表格（Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.2 / Mythos 5.2 / Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 等）列出「无 thinking 字段」「adaptive」「enabled + budget_tokens」「between_tools」「disabled」五种取值的结果，大量组合为 **400 error**；例：Opus 5.5 所有显式关闭都 400；4.8/4.7 缺省即 "Thinking off"；thinking block 带 `signature`（加密的完整推理，需原样回传）；`display` 为 `summarized`/`omitted`，新模型默认 `omitted`（thinking 文本为空但仍计费、仍回传）。

4. **Anthropic — Context editing** `https://platform.claude.com/docs/en/build-with-claude/context-editing.md`
   观测："For most use cases, server-side compaction is the primary strategy"；context editing 是服务端策略（`clear_tool_uses_20250919`、`clear_thinking_20251015`），在 prompt 到达模型前应用；参数含 `trigger`（如 `input_tokens > 30000`）、`keep`、`clear_at_least`、`exclude_tools`；"When thinking blocks are cleared, the cache is invalidated at the point where clearing occurs"。

5. **Anthropic — Web search tool** `https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md`
   观测：`tools` 里加 `web_search`，**服务端执行**；响应带 citations；`max_uses`、`allowed_domains`/`blocked_domains`（不能同时给，同时给 400）；`web_search_20260209` 起支持 dynamic filtering（Claude 4.6+ 与 Mythos Preview）；`pause_turn` 服务端循环语义；"Claude answers directly without searching when the request draws on stable knowledge"。

6. **Anthropic — Code execution tool** `https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool.md`
   观测：在**沙箱容器**里跑 Python/Bash、读写文件、处理上传文件；工具版本 `code_execution_20250825` 及更新版；Haiku 4.5 上 programmatic tool calling 与 REPL 状态持久化不可用；**容器数据最多保留 30 天，ZDR 不适用**；"Code execution is free when used with web search or web fetch (`web_search_20260209`, `web_fetch_20260209`, or later)"。

7. **OpenAI — 官方 SDK 类型（由 OpenAPI 生成）**
   `https://github.com/openai/openai-python/blob/main/src/openai/types/shared/reasoning_effort.py`
   `https://github.com/openai/openai-python/blob/main/src/openai/types/shared/reasoning.py`
   `https://github.com/openai/openai-python/blob/main/src/openai/types/chat/completion_create_params.py`
   `https://github.com/openai/openai-python/blob/main/src/openai/types/completion_usage.py`
   `https://github.com/openai/openai-python/blob/main/src/openai/types/responses/tool_param.py`
   观测：`ReasoningEffort = Literal["none","minimal","low","medium","high","xhigh","max"]`；`Reasoning.effort` 文档串："Not all reasoning models support every value. See the reasoning guide for model-specific support"；`Reasoning.context` = `auto/current_turn/all_turns`（`gpt-5.6` 家族默认 `all_turns`，更早模型默认 `current_turn`）；`Reasoning.summary` = `auto/concise/detailed`（`generate_summary` 已 deprecated）；`temperature` 0–2；`max_tokens` 已 deprecated 且"not compatible with o-series models"，`max_completion_tokens` 是上界且**包含 reasoning tokens**；usage 明细含 `completion_tokens_details.reasoning_tokens`、`prompt_tokens_details.cached_tokens`/`cache_write_tokens`；Responses 托管工具族含 `web_search`/`web_search_preview`/`code_interpreter`（container + network policy）/`file_search`/`image_generation`/`computer_use`/`mcp`/`local_shell`。

8. **Google — 官方 SDK 类型（Gemini API）** `https://github.com/googleapis/python-genai/blob/main/google/genai/types.py`
   观测：`ThinkingConfig{include_thoughts, thinking_budget, thinking_level}`；`thinking_budget` 文档串："0 is DISABLED. -1 is AUTOMATIC. The default values and allowed ranges are model dependent"；`ThinkingLevel` 枚举 = `THINKING_LEVEL_UNSPECIFIED/MINIMAL/LOW/MEDIUM/HIGH/XHIGH`（**无 MAX**）；`GenerateContentConfig` 含 `temperature`/`top_p`/`top_k`/`max_output_tokens`/`candidate_count`；`UsageMetadata` 含 `thoughts_token_count`、`cached_content_token_count`、`tool_use_prompt_token_count`，且文档串写明 `total_token_count` = prompt + candidates + tool_use_prompt + thoughts。

9. **Google — Gemini API proto（工具定义）** `https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/content.proto`
   观测：`GoogleSearch` 带 `time_range_filter`；`CodeExecution` 结果枚举 `OUTCOME_OK`/`OUTCOME_FAILED`/`OUTCOME_DEADLINE_EXCEEDED`（含 stdout/stderr 回传）；同文件还有 `ComputerUse` 工具族。

10. **DeepSeek — 思考模式指南** `https://api-docs.deepseek.com/zh-cn/guides/thinking_mode`
    `https://api-docs.deepseek.com/api/create-chat-completion`
    观测：思考模式默认开启、默认 effort=`high`；控制参数三套并列（OpenAI 格式 `thinking.type` / Anthropic 格式 / Responses 格式 `reasoning.effort`，`none` 表示关闭）；effort 映射表 `minimal→low, low→low, medium→high, high→high, xhigh→high, max→max, ultra→max`；"思考模式不支持 temperature、presence_penalty、frequency_penalty 参数……设置参数不会报错，但也不会生效"；`top_p` 在 `deepseek-flash` 仅思考模式生效、有效区间 0.95–1.0（低于按 0.95），在 `deepseek-v4-pro` 思考模式忽略；`reasoning_content` 与 `content` 同级，**带 `tools` 时必须完整回传，否则 400**，不带 tools 时忽略；`max_tokens` 1–393216，默认 8K（非思考）/64K（思考）/128K（`reasoning_effort=max`）；`temperature` 0–2 默认 1，"Has no effect in thinking mode"；usage 含 `prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`、`cached_tokens`，且 `prompt_tokens = hit + miss`。

### 来源时效性核对

- Anthropic 页面示例使用 `anthropic-version: 2026-10-21`，并在模型中列出 Opus 5.5 / Sonnet 5.5 / Fable 5.2 / Mythos 5.2，与本日时间线一致；不是旧版页面缓存。
- DeepSeek 页面模型名为 `deepseek-flash`、`deepseek-v4-pro`，且文档顶部有"全家桶应用 API 已发布"公告，属当前版本。
- OpenAI SDK 类型含 `gpt-5.6` 家族与 `xhigh/max` 枚举，属当前 spec 生成物。
- Gemini SDK 的 `ThinkingLevel` 含 `XHIGH`，属当前版本枚举。

## 厂商事实（逐条带 URL）

### OpenAI

- `ReasoningEffort` 可取 `none/minimal/low/medium/high/xhigh/max`，且**并非所有推理模型支持每个值**。来源：`reasoning_effort.py`、`reasoning.py`（同上第 7 条）。
- 官方把「模型级支持」交给 reasoning guide 说明——该页在本环境不可达（见"覆盖缺口"），故本文件**不**断言具体哪个模型支持哪些值。
- `max_tokens` 已 deprecated，`max_completion_tokens` 为推荐上界，且**包含 reasoning tokens**；`max_tokens` 与 o-series 不兼容。同上。
- 推理摘要通过 `reasoning.summary`（`auto/concise/detailed`）获取，`generate_summary` 已 deprecated；`reasoning.context` 控制历史 reasoning 项是否回放（`gpt-5.6` 家族默认 `all_turns`）。同上。
- 托管工具是 Responses API 的服务端工具族（`web_search`、`code_interpreter` 带 container 与 network policy、`file_search`、`image_generation`、`computer_use`、`mcp`、`local_shell`）。同上。

### Anthropic

- 现行控制手段是 `output_config.effort`（low/medium/high/xhigh/max），**不是** `reasoning_effort`，也不是 thinking budget；effort 是行为信号，"not a strict token budget"，且作用于全部输出 token（含工具调用与 thinking）。来源 1。
- 默认值随模型变化：Opus 5.5 / Haiku 5.5 默认 `medium`，其余支持 effort 的模型默认 `high`；省略 effort 与显式写成默认值行为**完全相同**。来源 1。
- `max` 与 `xhigh` 的支持面不同，"Not every model that supports `max` supports `xhigh`"。来源 1。
- 旧的手动 thinking（`type:"enabled"` + `budget_tokens`）是 legacy；4.7+ **拒绝并返回 400**；budget ≥1024 且 < `max_tokens`；`max_tokens` 仍是含 thinking 的硬上限；改 budget 会击穿 prompt cache。来源 2。
- 各模型对 `thinking` 五种取值的响应在矩阵里逐格写明（400 / adaptive / 摘要关闭 / 仅低于 xhigh 可用等）。来源 3。
- thinking block 带加密 `signature`，多轮/工具场景必须原样回传；`display` 默认 `omitted`，thinking 文本可能为空但仍计费。来源 3。
- 上下文管理官方推荐 server-side compaction；context editing 提供 `clear_tool_uses`/`clear_thinking`，清 thinking 会使缓存失效。来源 4。
- 内置 web search 是服务端工具，带 citations、`max_uses`、域名黑白名单、dynamic filtering；内置 code execution 是沙箱容器（Bash + 文件），**容器数据留 30 天且 ZDR 不适用**，与 web search/web fetch 同用时免费。来源 5、6。

### Gemini

- 思考控制有两套字段：`thinking_budget`（0=关闭，-1=自动，**默认值与允许范围依模型而定**）与 `thinking_level`（MINIMAL/LOW/MEDIUM/HIGH/XHIGH）。来源 8。
- `temperature`/`top_p`/`top_k`/`max_output_tokens` 均为可选请求字段；官方类型未给固定范围或默认值（默认由服务端/模型决定）。来源 8。
- usage 明确区分 `thoughts_token_count`、`cached_content_token_count`、`tool_use_prompt_token_count`，`total_token_count` 为四者之和。来源 8。
- 工具侧有 `GoogleSearch`（带时间范围过滤）与 `CodeExecution`（结果含 OK/FAILED/DEADLINE_EXCEEDED 与 stdout/stderr），属服务端执行。来源 9。

### DeepSeek

- 思考模式**默认开启**、默认 effort=`high`；开关在 OpenAI 格式是 `extra_body.thinking.type`，在 Responses 格式是 `reasoning.effort: none`。来源 10。
- effort 只认 `low/high/max`，并对其余值做静默映射：`minimal→low`、`medium→high`、`xhigh→high`、`ultra→max`。来源 10。
- **思考模式不支持 temperature / presence_penalty / frequency_penalty：不报错但也不生效**。来源 10。
- `top_p` 行为分模型：`deepseek-flash` 仅思考模式生效并夹到 0.95–1.0；`deepseek-v4-pro` 思考模式忽略（带工具时固定 0.95，否则 1.0）。来源 10。
- `reasoning_content` 与 `content` 同级；带 `tools` 时必须完整回传历史 reasoning_content，否则 400；不带 tools 时会被忽略且不拼进上下文。来源 10。
- `max_tokens` 1–393216，默认 8K（非思考）/64K（思考）/128K（effort=max）；`temperature` 默认 1，思考模式无效。来源 10。
- 搜索/文件/URL 读取是**独立应用 API**（文档顶部公告），不是模型内置 tool。来源 10。

## 对照 AIChat 现有设置（代码事实）

代码事实来自本次只读检查，用于把上面的厂商事实落到具体字段。

| 字段（`packages/shared/src/settings-contract.ts`） | 现状（代码观测） | 与官方事实的冲突 |
| --- | --- | --- |
| `openaiReasoningEffort` (:35) | 枚举 `low/medium/high/max/xhigh/unset`（`packages/backend/src/api/settings.ts:151`） | 缺 `none`/`minimal`（OpenAI 有、Gemini 有 MINIMAL）；缺 DeepSeek 的语义映射；单一全局值 |
| 注入方式（优先级） | `chat-request-builder.ts:626-632` 取有效 effort 的顺序是 **请求 payload → 会话 → 系统全局 `openai_reasoning_effort` → env `OPENAI_REASONING_EFFORT`**；`:645-649` 先 `delete body.reasoning_effort`，只有 `reasoning.enabled && reasoning.effort` 都为真才写回；`deepseek_compat` 方言另写 `thinking:{type}` | 全局值只是兜底，并非无条件下发；但**有效 effort 没有任何模型能力校验**（不查模型是否支持该取值/该字段），不匹配时结果是 400 或被厂商忽略 |
| Anthropic 侧映射 | `anthropic-convert.ts:18-25` 固定表 `low 2048 / medium 4096 / high 8192 / xhigh 16384 / max 16384`，并强制 `budget_tokens < max_tokens`(:325-330) | Anthropic 现行是 `output_config.effort`（行为信号）；4.7+ 对 `enabled+budget_tokens` 返回 400；该表只对 ≤4.6/4.5 成立 |
| `reasoningMaxOutputTokensDefault` (:60) | 默认 `32000`（`settings-service.ts:354`），上限 256000；Anthropic 适配层另有兜底：`anthropic-convert.ts:278-289` 从 `max_tokens`/`max_completion_tokens`/`max_output_tokens` 取值，**全部缺失时补 `ANTHROPIC_DEFAULT_MAX_TOKENS = 4096`**(:16) | DeepSeek 默认 8K/64K/128K、上限 384K；Anthropic 高端模型建议 128K 且含 thinking。固定 32000 会截断或低于厂商默认；而「留空」在 Anthropic 路径上等于 4096，不是厂商默认 → 应实现「自动／按模型协议解析」 |
| `temperatureDefault` (:76) | 解析顺序 `catalog metaJson.temperature` → 系统默认 → 0.7（`chat-request-builder.ts:828-839`）；Anthropic 路径另有 clamp 到 [0,1]（`anthropic-convert.ts:295-298`） | 顺序已支持 per-model，UI 仍只暴露全局且范围 0~2（实际对 Anthropic 被压到 ≤1）；DeepSeek 思考模式忽略 temperature、Gemini 未给范围、Anthropic 未在可访问页面给出约束 |
| `reasoningTagsMode` / `reasoningCustomTags` (:62,:57) | 默认匹配 `think`、`<thinking>`、`<|begin_of_thought|>` 等文本标签（`packages/backend/src/utils/reasoning-tags.ts:21-30`） | 官方四家均用结构化字段承载推理，标签解析只剩第三方兼容价值。但这是**解析层**结论，需与其它四件事分开看：是否启用识别（`reasoningEnabled`）、UI 是否展示/折叠、是否落库（`reasoningSaveToDb`）、协议是否必须回传（Anthropic `signature`、DeepSeek 带 tools 的 `reasoning_content`）。标签模式只管第一件 |
| `reasoningSaveToDb` (:61) | 保存推理内容到业务库 | 「落库」与「协议回传」是两件事：Anthropic 要求 `signature` 原样回传、DeepSeek 带 tools 时必须回传 `reasoning_content`；这两项是请求契约，不能由「是否落库」开关决定 |
| `contextCompression*` (:24-26) | 自建阈值压缩（ratio / tail messages） | Anthropic 明确 server-side compaction 为首选；清 thinking 会让缓存失效 |
| `usageEmit` / `usageProviderOnly` (:82-83) | 现有 usage 字段映射 | 缺 `reasoning_tokens`/`thinking_tokens`/`thoughts_token_count`/`cache_write_tokens` 会降低**分项可解释性与成本归因**；不能据此断言总成本低估——总量字段（completion/total）很可能已含 reasoning tokens，需先核对各厂商总量口径再定结论 |
| `webSearch*` / `pythonTool*` | 自托管多引擎搜索 + 自托管 Python 执行 | 内置工具不能等价替代（见下一节）。注：Python 侧**当前具体键是否生效**属于代码审计结论（已有个别键被证为死键），本文件不以此支撑「保留」，只给能力层面的判断 |

## 内置 web search / code execution 能否替代自托管

先给事实边界，再给判断。

**事实**

- 三家的内置能力都是**托管工具**，由厂商侧执行：Anthropic 的 `web_search` 走服务端循环（含 `pause_turn`）、带 citations 与域名白名单，`code_execution` 是沙箱容器且**数据留 30 天、ZDR 不适用**（来源 5、6）；OpenAI 的 `web_search`/`code_interpreter` 是 Responses 托管工具族，容器带 network policy（来源 7）；Gemini 的 `GoogleSearch`/`CodeExecution` 同样服务端执行（来源 9）。
- DeepSeek 没有模型内置搜索工具，其搜索/抓取是独立应用 API（来源 10）。
- 这些工具的配置面远小于自建：Anthropic 只暴露 `max_uses`、域名黑白名单、`user_location`；OpenAI 暴露 filters / user_location / container 网络策略；引擎选择、多引擎并行、双语、结果合并策略均不可配。
- 托管容器的数据边界：它跑在厂商侧隔离容器里，**默认不直接访问用户本机的会话文件、知识库或工作区**；要用上自己的数据，必须经单独集成把数据送进去（Anthropic 文档描述的是处理 "uploaded files"，OpenAI 是 container 及其网络策略），或走 MCP／连接器一类的显式通道。

**判断（产品推断，非厂商陈述）**

1. **搜索不能替代**。AIChat 现有能力（五引擎编排、引擎顺序、并行合并、自动阅读并行度/批次时限、双语检索、域名过滤、原文抓取）在托管工具里没有对应旋钮；且 DeepSeek 连接下根本没有内置工具，一致性会立刻破裂。托管工具真正替代的是"引擎运维与反爬"这一层。
2. **代码执行不能等价替代**。厂商沙箱默认隔离于本地，访问项目数据的路径变成"先上传／再执行"，而不是"就地读工作区"；留存条款也不同（Anthropic 明确容器数据留 30 天、ZDR 不适用）。它可以覆盖"通用算力 + 数据处理"，但覆盖不了"直接对本地工作区与知识库执行"这条既有链路。自托管执行的具体配置键是否生效，以代码审计结论为准。
3. **正确的产品位置是"按连接可选的内置工具"，与自托管并存**：内置搜索适合"要引用、要低运维、单轮事实核查"；自托管适合"要引擎/语料/域名策略与跨厂商一致性"。

## 哪些全局设置应自动检测/按模型，哪些依旧有用

| 设置 | 建议归属 | 依据 |
| --- | --- | --- |
| `openaiReasoningEffort` | 改为**按连接/按模型**；全局仅作兜底并保持默认 `unset`；下发前按模型能力校验（不支持的取值不下发） | 优先级是 payload → 会话 → 全局 → env，且需 `enabled && effort` 才发送，但**没有模型能力校验**（代码事实）；四家枚举与默认值又各不相同 |
| effort 可选值集合 | 由模型能力决定（自动检测/目录声明），UI 按模型裁剪 | OpenAI 有 `none/minimal`，Gemini 有 `MINIMAL`，DeepSeek 映射 `xhigh→high`，Anthropic 的 `xhigh` 非全支持 |
| `temperatureDefault` | 保留，但降级为 **fallback**；主用 per-model；thinking 模式默认不发送 | DeepSeek 思考模式忽略 temperature；已有 catalog 覆盖通道（代码事实） |
| `reasoningMaxOutputTokensDefault` | 改为「**自动／按模型协议解析**」：未显式设置时按目标模型给出该模型的默认与上限，而不是留空或写死 32000 | DeepSeek 默认 8K/64K/128K、上限 384K；Anthropic `max_tokens` 含 thinking；且 Anthropic 适配层在缺省时会补 4096（代码事实），所以"留空"不等于交厂商 |
| `reasoningTagsMode` / `reasoningCustomTags` | 保留但**默认按连接方言**，官方四家建议 off；只管"文本标签解析"这一层 | 官方均用结构化字段；解析、启用、展示、存储、协议回传要分开设计 |
| `reasoningEnabled` | 保留，但需识别"该模型无法关闭 thinking"（如 Opus 5.5 显式 disabled=400） | 来源 3 的矩阵 |
| `reasoningSaveToDb` | 保留；落库策略与协议回传**解耦**——回传由请求契约决定，不受此开关影响 | 来源 2、3、10 |
| `contextCompression*` | 保留自建；对支持厂商侧压缩的连接可选优先 | 来源 4 |
| `usageEmit` / `usageProviderOnly` | 保留；补 reasoning/cache 明细以恢复分项可解释性，结论前先核对总量口径 | 来源 7、8、10、2 |
| `pythonTool*`、`webSearch*` | 能力层面建议保留（内置工具不可等价替代）；**具体键的存废以代码审计为准** | 见上一节；Python 侧已有键被证为无效，本文件不据此定键级结论 |
| `stream*` / keepalive / timeout | 保留全局（纯传输层，与模型能力无关） | 与厂商参数契约无关 |

## 覆盖缺口（未验证，勿据此断言）

1. **OpenAI reasoning guide 原文**（`platform.openai.com/docs/guides/reasoning`）不可达 → 未验证：哪些具体模型支持哪些 effort 值、temperature/top_p 在推理模型上的确切行为。本文件只引用 SDK 类型与其中的"see the reasoning guide for model-specific support"。
2. **OpenAI 计费页**（`openai.com/api/pricing`）不可达 → 未验证托管工具与 reasoning tokens 的价格。
3. **Anthropic Messages API reference**（`.../api/messages/create.md`）返回 184 字节占位 → 未验证 `temperature`/`top_p` 的取值约束，以及 thinking 与采样参数的官方互斥描述。本文件**不**断言"thinking 时 temperature 必须为 1"这类旧规则仍成立。
4. **Anthropic 定价页**（`.../about-claude/pricing.md`）被区域限制拦截 → 未验证 web search / code execution 的单价。仅引用文档中"与 web search/web fetch 同用时 code execution 免费"这一句。
5. **Gemini per-model thinking 预算范围与 `thinking_level` 可用性**（`ai.google.dev/gemini-api/docs/thinking`）不可达 → 未验证具体模型的具体区间与默认值；只引用官方字段语义"model dependent"。
6. **DeepSeek 内置搜索 API 的模型侧可用性** → 只确认它是独立应用 API，未验证能否在 chat completion 中作为 tool 挂载。

## 对审计主报告的输入

- effort 需要按模型/连接收敛：有效值来自 payload → 会话 → 全局 → env，且只有 `reasoningEnabled && effort` 才下发，但全程没有模型能力校验。四家枚举与默认值不同，不匹配时**可能返回 400，也可能被厂商忽略**；这一条由官方文档的枚举与逐模型表格，加上本项目注入代码共同支撑。
- `temperature` 不是"过时设置"，但要停止假设它处处生效（DeepSeek 思考模式忽略、Anthropic 路径被 clamp 到 ≤1）；`max output tokens` 的全局固定默认值风险更高，正确形态是"自动／按模型协议解析"，不是简单留空。
- `think` 标签解析是兼容层而非主路径；官方四家都有结构化承载，且两家对"回传推理内容"有硬契约（Anthropic signature、DeepSeek `reasoning_content`+tools）。
- 内置 web search / code execution 应作为可选能力接入，而不是替换自托管搜索与 Python 执行：托管容器默认不触达本地数据（需单独集成上传），且 DeepSeek 连接没有内置 tool。

## 实施核实：Anthropic effort 模型门控（2026-11-16 抓取）

以下是本轮实现时对官方页面的一次直接复核（未做任何付费调用），记录原文关键结论与落点。

来源：`https://platform.claude.com/docs/en/build-with-claude/effort`（2026-11-16 抓取，HTTP 200）。

- **supportedModels**：页面 frontmatter 的 `featureMetadata.supportedModels` 列出 17 个支持 `output_config.effort` 的模型：`claude-fable-5-2 / mythos-5-2 / fable-5-1 / mythos-5-1 / fable-5 / mythos-5 / mythos-preview / opus-5-5 / opus-5 / sonnet-5-5 / sonnet-5 / haiku-5-5 / opus-4-8 / opus-4-7 / opus-4-6 / sonnet-4-6 / opus-4-5-20251101`。`claude-sonnet-4-5`、`claude-haiku-4-5` 等不在列表。
- **等级可用面**：`max` 覆盖 Fable/Mythos 5.x、Mythos Preview、Opus 5.5/5/4.8/4.7/4.6、Sonnet 5.5/5/4.6、Haiku 5.5；`xhigh` 不含 Opus 4.6、Sonnet 4.6 与 Mythos Preview；`low/medium/high` 对所有支持模型可用；`claude-opus-4-5-20251101` 只支持 `low/medium/high`。页面原文：“Not every model that supports `max` supports `xhigh`”。
- **默认值**：除 Claude Opus 5.5 与 Claude Haiku 5.5 默认为 `medium` 外，其余支持模型默认 `high`；显式设置等于默认值时行为与省略相同。
- **anthropic-version**：页面仅在示例请求里出现 `anthropic-version: 2026-10-21`，正文没有“effort 受版本头门控”的陈述；`api/versioning`、`api/overview` 两个页面在本环境被区域限制拦截（返回 184 字节的 “App unavailable” 占位），无法作为证据。因此实现**不提高默认头**，只在模型+等级层面门控；需要更高版本时用连接自定义 Headers 覆盖。

落点：`packages/backend/src/utils/anthropic-effort.ts` 固化上述模型×等级矩阵（含前缀/日期快照匹配，未列入官方列表的历史快照保持不支持）；`anthropic-convert` 仅在目标模型支持该等级时写 `output_config.effort`；模型目录的 `efforts` 改为按模型返回；`thinking.budget_tokens` 仍只在自定义请求体显式给出时使用（Claude 4.7+ 直接 400）。

同轮另一处协议口径：Anthropic 的 `max_tokens` 必填，自动模式取保守值 4096 且被剩余上下文收敛；OpenAI 系可省略 `max_tokens`，不再用上下文总上限充当输出上限。
