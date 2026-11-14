# 联网搜索五引擎接口对齐报告（2026-11-14）

本报告记录 tavily / brave / metaso / exa / deepseek 五个搜索适配器与各自官方接口文档的逐项对照，以及本次补齐的差异。文档依据均为官方站点，抓取时间为 2026-11-14。

| 引擎 | 官方文档 |
| --- | --- |
| Tavily | `https://docs.tavily.com/documentation/api-reference/endpoint/search`（页面内嵌 OpenAPI） |
| Brave | `https://api-dashboard.search.brave.com/api-reference/web/search/get/index.html.md`、`.../images/image_search/index.html.md`、`.../documentation/resources/search-operators/index.html.md` |
| Metaso | `https://metaso.cn/search-api/playground`（官方 playground 的请求体构造）+ 官方 `metaso-sdk` 0.1.6 源码 |
| Exa | `https://docs.exa.ai/reference/search`（内嵌 `exa-spec.yaml`） |
| DeepSeek | `https://api-docs.deepseek.com/zh-cn/guides/search/`、`/zh-cn/api/search` |

## 结论速览

| 引擎 | 端点/鉴权 | 请求参数 | 响应映射 | 本次处理 |
| --- | --- | --- | --- | --- |
| Tavily | 一致（改为文档化的 Bearer 鉴权） | 缺 `include_raw_content`、`chunks_per_source`、`include_published_date`，域名未归一化/未限长 | 缺 `raw_content`、`published_date` | 已补齐 |
| Brave | 一致 | 缺 `text_decorations=false`、`extra_snippets=true`；域名白名单未生效 | 缺 `extra_snippets`、`page_age`、`profile.name`；图片结果未取 `properties.url` | 已补齐 |
| Metaso | 一致 | 发送了不属于搜索接口的 `stream`/`output`/`format`；`includeRawContent` 未按 scope 收口；`paper` 不是官方 scope | 未读 `webpages`；域名白名单未生效 | 已补齐 |
| Exa | 一致 | 缺 `contents.text`、`contents.summary`，域名未归一化 | 缺 `publishedDate` | 已补齐 |
| DeepSeek | 一致 | 缺 `ori_question` | 缺 `date`、`site_name`、`authority` | 已补齐 |

## Tavily

文档事实：

- 鉴权是 OpenAPI 里的 `bearerAuth`：`Authorization: Bearer <key>`；请求体 schema 中已没有 `api_key`。
- `search_depth` 四档（basic 1 credit、advanced 2 credits）；`chunks_per_source` 1-3，作用于 `content`。
- `include_raw_content` 支持 `markdown`/`text`；`include_published_date` 为 beta，新闻主题自动开启。
- `include_domains` 上限 300 条，`exclude_domains` 上限 150 条。
- 结果字段：`title`、`url`、`content`、`score`、`raw_content`、`published_date`、`favicon`、`images[]`。

本项目原状与修复：

- 原实现把 `api_key` 放在请求体，属于文档已移除的旧写法 → 改用 Bearer 头。
- 设置页的「获取网页原文」对 Tavily 完全无效（没传 `include_raw_content`）→ 开启时传 `markdown` 并把 `raw_content` 作为 `content`；关闭时显式传 `chunks_per_source: 3`，让 `content` 保持多段语义片段。
- 未请求 `published_date` → 打开并用它填充 `publishedDate`。
- 域名白名单原样透传（可能带 `https://` 前缀或超长）→ 归一成主机名并截断到 300 条。
- 失败时把上游响应体整段拼进错误 → 统一为「状态码 + Retry-After」，不再回显上游正文（上游错误体可能原样包含 API Key，仓库已有测试把「不泄露上游正文」锁定为契约）。

保留不改：`search_depth` 仍为 `advanced`。项目定位是给模型做证据检索，精度优先；代价是每次 2 credits，已在代码注释与本报告标注。

## Brave

文档事实：

- 鉴权 `X-Subscription-Token`；web 搜索 `count` 1-20、`offset` 0-9。
- `text_decorations` 默认 `true`，会在 `description` 中插入高亮标记字符。
- `extra_snippets=true` 每条结果最多再给 5 段备选摘录。
- `site:` 与 `OR` 是文档化的搜索操作符。
- 图片搜索：`properties.url` 是原图，`thumbnail.src` 是 Brave 缓存缩略图；`results[].url` 是页面地址。

本项目原状与修复：

- 原来用字符串拼接 URL，只带 `q`/`count` → 改用 `URL`/`searchParams` 组装，并补 `text_decorations=false`、`extra_snippets=true`（摘要不再夹带高亮标记，正文线索更多）。
- 域名白名单对 Brave 从未生效 → 用文档化的 `site:a OR site:b` 操作符拼进查询。
- `extra_snippets` 合并进 `content`（`description` 之间空行分隔），`page_age` 映射 `publishedDate`，`profile.name` 映射 `siteName`。
- 图片搜索补读 `properties.url`（原图），缺失时才退回 `thumbnail.src`。

## Metaso

文档事实（官方 playground 的请求体构造）：

- 端点 `POST https://metaso.cn/api/v1/search`，Bearer 鉴权。
- 搜索请求体只有：`q`、`scope`、`includeSummary`、`size`（或 `page`，每页 10 条，1-10）、`conciseSnippet`，以及仅网页范围生效的 `includeRawContent`。
- 官方 scope 只有六个：`webpage`、`document`、`scholar`、`image`、`video`、`podcast`。
- `stream` / `output` / `format` / `model` 属于 `/api/v1/chat/completions`（问答）与 `/api/v1/reader`（读页）接口，不属于搜索接口。

本项目原状与修复：

- 原实现往搜索请求体里塞了 `stream`、`output`、`format` → 移除，只保留文档字段。
- 原白名单含 `paper`（官方没有该 scope）→ 共享范围词汇仍保留 `paper`，但在适配层映射为官方 `scholar`；`scholar` 直接透传，非法值回落 `webpage`。
- `includeRawContent` 原来不看 scope → 现在仅 `scope=webpage` 时发送（官方限制）。
- 域名白名单对 Metaso 无效（接口没有域名参数）→ 在适配层按主机名做本地白名单过滤，与 UI「域名白名单」语义一致。
- 响应解析补 `webpages` 字段（官方网页结果的常见外层键），并保留原有宽松兜底。

保留不改：没有启用 `page` 分页。`size` 已能覆盖项目 ≤10 条的融合上限，分页只会增加请求数。

## Exa

文档事实：

- 鉴权 `x-api-key` 或 `Authorization: Bearer`（本项目沿用 `x-api-key`）。
- `contents.text`（布尔或 `{ maxCharacters }`）返回正文；`contents.highlights` 返回与查询相关的摘录；`contents.summary` 是对象形式（`{ query }`），返回 LLM 摘要。
- `includeDomains` 支持主机名、路径前缀与通配子域。
- 结果字段：`title`、`url`、`publishedDate`、`author`、`text`、`highlights`、`summary`、`image`、`favicon`、`extras.imageLinks`。

本项目原状与修复：

- 「获取网页原文」对 Exa 无效 → 开启时请求 `contents.text = { maxCharacters: 4000 }` 并映射到 `content`。
- 「召回增强」只对 Metaso 生效 → Exa 在开启时请求 `contents.summary = { query }`，`summary` 作为 snippet 的次级来源（优先 `highlights`）。
- `publishedDate` 未映射 → 已补。
- 域名白名单归一成主机名（原样透传 `https://...` 会被 Exa 当成路径前缀）。

## DeepSeek

文档事实：

- `POST https://api.deepseek.com/v1/tools/search`，Bearer；`query` 1-128 Unicode 字符；`count` 1-50；`ori_question` 1-128 字符；`localization` 为 IP；`need_content` 控制 `content`。
- 结果字段：`rerank_score`、`title`、`url`、`snippet`（100-200 字）、`summary`（600-800 字）、`content`、`site_name`、`site_icon`、`date`、`authority`。
- 错误表：400 / 401 / 402 / 403 / 404 / 408 / 413 / 429 / 500 / 504；错误体是 OpenAI 兼容结构。

本项目原状与修复：

- 未传 `ori_question` → 现在把用户原始问题（未做双语扩展的那条）作为 `ori_question`；超 128 字符时省略而不是截断。
- 未映射 `date` / `site_name` / `authority` → 已映射并在模型摘要里输出（`publishedDate` / `siteName` / `authority`）。
- 错误提示只覆盖 401/402/429/422/5xx → 补齐 400/403/404/408/413/504 的语义；仍然只输出状态码提示，不拼接上游 `error.message`（可能回显 Key）。

保留不改：`localization` 需要客户端 IP，服务端多用户场景下没有可信来源，未启用。

## 范围（scope）处理现状

- 统一范围词汇收敛到 `@aichat/shared/web-search-contract` 的 `WEB_SEARCH_SCOPE_IDS`（webpage/document/paper/scholar/image/video/podcast），运行时校验、设置页下拉与工具 schema 共用同一份。
- 只有 Metaso 支持全部六个范围；Tavily / Brave / Exa 只在 `image` 有专属分支（Tavily 顶层图片、Brave 图片搜索端点、Exa 展平页面配图）。其余范围下这几家仍返回普通网页结果——这是各引擎的能力差异，不是请求参数错误，本次未改动路由行为。

## 验证

- 新增 `packages/backend/src/utils/__tests__/web-search-providers.test.ts`（17 项），逐条断言请求形状（鉴权头、文档字段、scope 映射、域名归一/收口）与响应映射（正文、摘要、发布时间、站点名、权威性、图片原图）。
- `packages/backend/src/utils/__tests__/web-search.test.ts`、`deepseek-tools.test.ts` 保持通过；后端类型检查与前端类型检查通过。
- 未调用任何真实收费接口：全部验证基于 mock 的文档示例响应。
