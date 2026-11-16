# 网页正文提取失败的分层处置报告（2026-11-16）

本报告回答一个问题：AiChat 联网搜索时"搜索成功、正文读不出来"，应当按什么顺序回退、按什么规则分类，才既不浪费预算也不误报成功。结论以三类证据为准：官方文档（逐条附链接）、本仓库源码（附文件与行号）、以及本次对公开端点的只读实测。范围仅限研究与文档，没有改动产品代码或配置，没有调用任何付费接口。

证据读取时间：2026-11-16。官方页面经 `curl` 直连或文档站 markdown 版本取得；Tavily / Exa 文档走官方站点的 `.md` 镜像，Jina 走 `https://jina.ai/reader` 服务端渲染正文。

## 一、结论速览

| 现象 | 正确分类 | 首选后继动作 | 同引擎重试是否有意义 |
| --- | --- | --- | --- |
| 200 + `text/html` + Readability 有正文 | 静态可读 | 直接交付 | 不需要 |
| 200 但正文容器为空、或页面含挑战特征 | JS 渲染 / 挑战 | 本地浏览器渲染一次；失败即降级为搜索摘要并标注原因 | 无意义：同一 HTTP 客户端只会拿到同一份骨架 |
| 403 / 429 / 503 + 挑战页 | WAF 挑战 | 同上；不要用"换个 User-Agent 再抓一次"当作方案 | 无意义：挑战是设计来拦住非浏览器的 |
| 404 / 410 / 软 404 删除页 | 内容不存在 | 只有"历史事实"类问题才查存档，且必须回传快照时间 | 无意义 |
| 阶段超时 | 预算耗尽 | 一次降级（摘要或换引擎），不叠加 | 无意义 |
| 只有搜索结果的 snippet / summary | 摘要，不是正文 | 作为低置信度证据交付并显式标注 | 不适用 |

三条最关键的判断：

1. **回退顺序的价值来自"每类失败先选一个合适的后继动作，再按剩余预算降级"，而不是来自阶段数量多。** 现在的链路（native → crawler → feed → browser → Google Cache → Wayback → DeepSeek fetch）把多个"同义动作"串起来，容易在有效后备阶段开始前耗尽预算。
2. **Google Cache 阶段已经失效，应当删除。** Google 官方已在 2024-09-24 移除 `cache:` 操作符文档并说明该操作符不再工作，2024-10-02 进一步说明"缓存链接功能在 Google 搜索结果中已不可用"。本次实测 `https://webcache.googleusercontent.com/search?q=cache:https://example.com` 返回 **HTTP 200 + 一段需要 JavaScript 的 Google 搜索中间页**，不是缓存正文；而 `fetchGoogleCache` 只校验"状态码 OK 且正文 ≥40 字符"就交给 Readability（`packages/backend/src/utils/url-reader.ts:1492`），存在把中间页当正文交付的风险。
3. **Wayback 的产出应携带快照时间，避免历史内容被误用于当前事实。** `fetchWaybackMachine` 读到了 `archived_snapshots.closest.timestamp`，但只用了 `snapshot.url`（`url-reader.ts:1554-1565`），`UrlReadResult` 也没有存档时间字段。对"实时行情/当前价格/今日赛程"这类问题，缺少快照时间会使模型误用旧数据。

**读法约定（先看这条）**：本报告出现的 `JS_CHALLENGE`、`WAF_CHALLENGE` 一律指**程序标签**，不是对站点行为的结论。诊断方用同一 `detectJsChallenge` 与同一组正则跑 fixture 已经证实：一篇完全正常的文章，只要正文出现 "Cloudflare" 公司名或 "CAPTCHA" 术语，判定结果就是 `true`；真实挑战页 fixture 同样是 `true`。所以"含 cloudflare/captcha 就是 WAF"不成立，任何据此认定站点拦截的推断都应撤回。

## 二、本地链路的真实参数与顺序

以下全部取自源码，不含推断。

### 2.1 入口与预算

| 项 | 值 | 出处 |
| --- | --- | --- |
| 手动 `read_url` 默认超时 | 30000 ms | `url-reader.ts:117`；配置回退同为 30000，clamp 5000–120000：`agent-tool-config.ts:355-362` |
| 搜索后自动读取默认超时 | 18000 ms | `web-search-handler.ts:55` |
| 自动读取条数 / 并发 / 正文上限 | 2 条 / 2 / 24000 字符 | `web-search-handler.ts:54,56,57` |
| 搜索层"获取网页原文"默认 | 关闭 | `agent-tool-config.ts:175-178` |
| 浏览器回退默认 | 开启（`URL_READER_BROWSER_ENABLE !== 'false'`） | `url-reader.ts:1692-1695`；配置默认 true：`agent-tool-config.ts:382-385` |
| 渲染后额外等待 | 默认 1200 ms，clamp 0–8000 | `agent-tool-config.ts:387-394` |
| 正文解析上限 / 响应体上限 | 1 MiB / 8 MiB | `url-reader.ts:118,129` |
| DeepSeek 抓取回退 | 默认关闭 | `agent-tool-config.ts:408` |

**关键结构问题**：整条链共享同一个 deadline。`readUrlContent` 起一个总超时，`readUrlContentLocal` 内部每个阶段都用 `budget.remainingMs()` 当自己的超时（`url-reader.ts:1822-2218` 全部阶段），没有阶段预算。后果是：native 一次慢响应就能吃掉全部预算，后面的 browser 根本没有机会跑；而最需要浏览器的恰恰是慢站点。

### 2.2 回退顺序（现状）

```text
native fetch（AIChat UA，Cache-Control: no-cache）
  ├─ 非 2xx（且非挑战、非 404）: crawler refetch（Chrome UA）
  ├─ JS 挑战特征: crawler refetch → feed → browser → Google Cache → Wayback
  ├─ 正文 < 100 字符: crawler refetch → feed → browser → Google Cache → Wayback
  ├─ Readability 失败: crawler 就地解析 → crawler refetch → feed → browser → Google Cache → Wayback
  └─ 抛错（非 TIMEOUT/INVALID/DISALLOWED）: 同上一条链
本地链最终失败 → 可选 DeepSeek fetch（仅当配置开启且为页面类资源）
```

各阶段细节：

- **crawler refetch**：只换 UA 与请求头（`url-reader.ts:1647-1675`）。它拿到挑战页时会主动判负（`detectJsChallenge(body)` 直接返回 null），所以"挑战类失败再 crawler 一次"在产品里不会产出结果，只是多一次请求。
- **feed**：`buildSameOriginFeedCandidates` 固定猜 6 个同源路径 `/rss/ `、`/feed/`、`/rss.xml`、`/feed.xml`、`/atom.xml`、`/index.xml`（`url-reader.ts:1601-1616`），顺序遍历，**每个候选都用 `budget.remainingMs()` 当超时**（`url-reader.ts:1628-1634`）。6 个候选串行、无单项上限，是挤占 browser 预算的最直接原因。
- **browser**：Playwright Chromium，`goto(waitUntil:'domcontentloaded')` → `networkidle` 上限 8s → 额外等待 `renderWaitMs` → 6 段滚动 → 取 `page.content()`（`url-reader.ts:1396-1432`）。只在 `enableBrowser` 为真且 Chromium 可解析时有效，否则 `tryBrowserFallback` 静默记一条 `skipped`（`url-reader.ts:1754-1758`）——**"浏览器没跑"在模型侧看起来和"站点读不了"一样**。
- **Google Cache**：`webcache.googleusercontent.com/search?q=cache:<url>`（`url-reader.ts:1481`），见第一节结论，已失效。
- **Wayback**：先查 `archive.org/wayback/available`，有快照再等 1.2s 取 `snapshot.url`（`url-reader.ts:1530-1569`，`WAYBACK_RATE_LIMIT_DELAY_MS=1200` 在 `:126`）。
- **DeepSeek fetch**：`POST https://api.deepseek.com/v1/tools/fetch`（`deepseek-tools.ts:5`），只在本地链失败、非 TIMEOUT/CANCELLED、且是页面类资源时触发（`url-reader.ts:2259-2263,2301-2314`）。

### 2.3 错误如何到达模型

- `read_url` 把 `error`、`errorCode`、`httpStatus`、`attempts` 一起写入工具消息（`url-reader-handler.ts:189-223`），但给模型的可读文本只有一句：`无法读取网页 "<url>"：<message>（错误码: X，HTTP: N）`（`url-reader.ts:2364-2375`）。
- 自动读取失败时会退回该条的搜索正文或 snippet，并标 `fallbackUsed: 'search_snippet'`，最后给一句统计"自动读取成功 N 条，失败 M 条"（`web-search-handler.ts:1058-1072,548-592`）。也就是说，**模型知道"失败了"，但不知道"该换什么动作"**。
- 搜索正文复用目前只认 DeepSeek：`searchContentByUrl` 过滤条件是 `sourceEngines.includes('deepseek')`（`web-search-handler.ts:980-990`）。Tavily 的 `include_raw_content`（`web-search.ts:377-379`）与 Exa 的 `contents.text`（`web-search.ts:634-637`）虽然已经把正文放进搜索响应，却不会被复用，自动读取仍会再抓一遍。

## 三、官方能力对照（候选第三方提取方案）

### 3.1 Tavily Extract

来源：<https://docs.tavily.com/documentation/api-reference/endpoint/extract.md>（请求/响应 schema 与错误表）、<https://docs.tavily.com/documentation/api-credits.md>（计费）。

| 参数 | 官方语义 |
| --- | --- |
| `urls` | 字符串或 **1–20 个 URL 数组**，一个请求批处理 |
| `query` | 用意图对抽取的 chunk 重排；只有提供它时 `chunks_per_source` 才可用 |
| `chunks_per_source` | 1–5，默认 3；每段约 800 字符，按 `<chunk 1> [...] <chunk 2>` 拼进 `raw_content`；页内 chunk 数不超过该值时返回全文 |
| `extract_depth` | `basic`（默认）/ `advanced`；advanced "检索更多数据，包括表格与嵌入内容，成功率更高但可能增加延迟" |
| `format` | `markdown`（默认）/ `text`（官方注明 text 可能增加延迟） |
| `timeout` | 1.0–60.0 秒；**不指定时按深度取默认：basic 10 秒、advanced 30 秒** |
| `include_images` / `include_favicon` / `include_published_date` | 默认 false；`published_date` 标注为 beta，取不到时为 null |

失败语义（决定回退逻辑，必须按官方原文实现）：

- 成功进 `results`、逐条失败进 `failed_results`（`{url, error}`）；**HTTP 200 也可能 `results` 为空（全部 URL 抽取失败），官方要求两个数组都检查**；输出顺序不保证。
- 400：超过 20 个 URL / 空列表 / 全部 URL 校验失败（此时 `detail.failed_results` 逐条给出原因）；401；429（带 `Retry-After`，官方说明等待时长会变化）；432 计划或 key 限额；433 PayGo 限额；500。
- 计费：**抽取失败不计费**。basic 每 5 个成功 URL 1 credit，advanced 每 5 个成功 URL 2 credits。按官方信用价 $0.008/credit 换算，1000 个成功 URL 约等于 basic 200 credits（≈$1.6）、advanced 400 credits（≈$3.2）——这是换算，不是官方报价。

适用场景：本地链失败后、单轮只差 1–2 条正文时按批提交；需要表格/嵌入内容时才升级 advanced，并相应放宽超时。

### 3.2 Exa Contents

来源：<https://docs.exa.ai/reference/contents.md>、<https://exa.ai/docs/reference/get-contents.md>（OpenAPI 约束）、<https://docs.exa.ai/reference/pricing.md>。

| 参数 | 官方语义 |
| --- | --- |
| `ids` / `urls` | 二选一，1–100 条，等价 |
| `text` / `highlights` / `summary` | `/contents` 是**顶层字段**，没有 `contents` 包裹；官方要求"每次请求选一种内容形态"，同时请求会**分别计费**；`text.maxCharacters` 1–5,000,000，默认 5,000,000 |
| `maxAgeHours` | 内容新鲜度开关：**省略**=有缓存用缓存、无缓存再抓；**正整数**=缓存新于 N 小时就用缓存，否则重抓（抓取失败可能返回最近的缓存副本）；**0**=要求 60 秒内抓取的实时内容；**-1**=只用缓存。范围 -1–720 |
| `livecrawlTimeout` | 实时抓取的超时，**默认 10000 ms，上限 90000 ms**；官方建议慢站提到 12000–15000 |
| `statuses[].source` | 每个 URL 的来源：`cached` 或 `crawled`，失败时给 `error` |
| `subpages` / `subpageTarget` | 从起始 URL 跟进子页并优先指定站点区块 |
| `costDollars` | 响应里直接返回本次费用 |

**`livecrawl` 已废弃**：官方给出迁移表——`always`→`maxAgeHours: 0`、`never`→`-1`、`fallback`→省略、`preferred`→建议用低值如 `1`；并且明确"不要同时发送 `livecrawl` 与 `maxAgeHours`"。

计费与一条容易漏掉的官方建议：`/contents` 为 **$1 / 1000 页，每种内容类型单独计费**（`text`+`highlights` 记 2 次）；官方说明"搜索返回的 URL 也可用同一套 contents 能力，**每次搜索前 10 条结果不额外收费**（超出 $1/1000 页）"，并直接建议 web search 场景优先用 `/search` 附带 contents 而不是单独调 `/contents`。

适用场景：需要"新鲜度可声明"的正文（`maxAgeHours` + `livecrawlTimeout`），或需要按 `crawled/cached` 区分"实时抓取"与"缓存副本"。

### 3.3 Jina Reader（可选，本项目源码当前没有集成）

来源：<https://jina.ai/reader>（参数区与速率限制表为服务端渲染正文）。

| 能力 | 官方语义 |
| --- | --- |
| 基本用法 | 在目标 URL 前面加 `https://r.jina.ai/`；官方明确"基本用法免费" |
| `X-Engine` | `direct` = 纯 HTTP 抓取（最快）；**默认引擎 = headless 浏览器渲染，先执行客户端 JS 再抽取**；`cf-browser-rendering` = 实验性的 Cloudflare 渲染后端 |
| `X-Timeout` | 等待页面加载的最大秒数 |
| `X-Cache-Tolerance` / `X-No-Cache` | 接受"年龄小于 N 秒"的缓存；`X-No-Cache: true` 等同强制新抓 |
| `X-Proxy-Url` / `X-Proxy` | 自定义代理；或按国家码选择（`auto`/`none`） |
| `X-Set-Cookie` | 转发自定义 Cookie；官方注明**带 Cookie 的请求不会被缓存** |
| `X-Respond-Timing` | 判定"页面已加载完"的时机，越晚等到越多动态内容 |
| 流模式 | 官方建议：大页面或标准模式内容不完整时改用 stream 模式，给页面更多渲染时间 |
| `X-Robots-Txt` | 可选按 robots.txt 规则检查 |

速率与延迟（官方表）：`r.jina.ai` 无 key **20 RPM**；免费 key 500 RPM；付费 key 500 RPM；Premium 5000 RPM；官方标注平均延迟 **7.9 s**；计费 token 数 = 输出响应 token 数（单价见其 Pricing 页，本次未取）。

适用场景：只在本地 browser 不具备、或需要对特定站点指定代理/渲染后端时作为阶段 5 的可选引擎。它不解决"必须登录/必须过交互式挑战"的站点，只是把渲染外包。

### 3.4 成本对照（同一件事的三种买法）

| 方案 | 计费口径 | 1000 页量级 | 备注 |
| --- | --- | --- | --- |
| Tavily Extract basic | 1 credit / 5 个成功 URL，失败不计费 | ≈200 credits，金额随套餐 | 默认超时 10s |
| Tavily Extract advanced | 2 credits / 5 个成功 URL | ≈400 credits，金额随套餐 | 含表格/嵌入内容，默认超时 30s，成功率更高但更慢 |
| Exa /contents | $1 / 1000 页，**每种内容类型各计一次** | $1 / 1000 页（单形态）；text+highlights = $2 / 1000 页 | 搜索前 10 条附带 contents 不额外收费 |
| Jina Reader | 输出 token 计费；无 key 20 RPM 免费基础用法 | 取决于正文长度 | 默认 headless 渲染，均值延迟约 7.9s |

## 四、六种"读不出来"必须分开说

1. **静态 HTTP 可读**：200 + HTML + Readability 成功。当前 `engine='native'`、`confidence=0.9`（`url-reader.ts:2116-2122`）。这类不需要任何回退。
2. **JS 渲染需求**：200，但正文容器为空或仅骨架；browser 渲染后出现正文。判定证据是 `rendered=true` 且 `engine='browser'`。这类值得一次浏览器渲染，其他回退需要结合内容类型与剩余预算选择。
3. **WAF / 挑战**：Cloudflare 官方说明挑战是"验证访客是否为真人而非机器人"的机制，其中拦截页（Interstitial Challenge Page）"在访客通过验证前拦在目标 URL 之前"，非交互挑战要求"浏览器处理注入的 JavaScript，通常少于 5 秒"，托管挑战则按浏览器信号动态选择挑战类型。对本项目而言这意味着：**HTTP 客户端拿到挑战页是预期行为，不是偶发错误**；重复同类 HTTP 请求通常不能改变结果；浏览器渲染有机会处理客户端 JavaScript，交互式验证仍可能阻断读取。

  注意判定方式：挑战的成立要看**响应头、挑战页结构与"通过后正文才出现"的行为**，不能靠关键词。当前实现用整页 HTML 匹配 7 条正则（`url-reader.ts:133-141`），正常文章含 "Cloudflare"/"CAPTCHA" 也会被判 true（fixture 已复现），所以关键词只能当辅助证据，不能当判据。
4. **内容不存在**：404 / 410 直接可判。**当前缺少软 404 判定**：一个 200 的"文章已删除"页面只要正文 ≥40 字符且 Readability 能抽到段落，就会被当成正文交付（`url-reader.ts:1492-1509` 的校验只看长度）。这与"读不出来"相反，是"读出来但内容不是原文"，风险更高。
5. **只有摘要**：搜索结果的 `snippet`/`summary` 是二手摘要，不是正文。当前自动读取失败会退回它并标 `search_snippet`（`web-search-handler.ts:1058-1072`），这个设计是对的，缺的是把"这是摘要、不是原文"讲给模型和用户。
6. **历史快照 vs 实时事实**：Wayback 的 availability API 官方定位是"检测某个 URL 是否已存档且当前可访问"，返回 `archived_snapshots.closest`（`url`/`timestamp`/`status`），无快照时返回 `{"archived_snapshots":{}}`；它明确是给错误页兜底用的检测接口，不是正文源的时效保证。因此：**实时价格、比分、行情、今日发布这类问题，默认不应回退到存档**；只有"这篇文章曾经写过什么"这类历史事实问题才用，并且必须把 `timestamp` 一并回传。

### 4.7 线上一次运行的失败分类（程序判定，需复核）

生产容器本轮启动后共 12 次 `url reader failed`，按现有规则分类为：**7 次 `JS_CHALLENGE`**（CNBC、TradingEconomics、中文维基百科、tastymoney、东方财富两条 URL、澎湃）、**2 次 `PARSE_EMPTY`**（腾讯 stockapp 首页、富途新闻列表）、**2 次 `HTTP403`**（Investing、TradingKey）、**1 次 `UNSUPPORTED_CONTENT_TYPE`**（cls.cn 详情页，响应缺 Content-Type）。

这组数字只能当"分类分布"，不能当"站点原因"，也不能当"站点拦截证据"。三处偏差必须写清：

- `JS_CHALLENGE` 的判定是"整页 HTML 命中 7 条正则之一"（`url-reader.ts:133-141`：`cf-chl`、`cloudflare`、`captcha`、`enable javascript`、`attention required`、`just a moment`、`verify you are human` 等）。诊断方用同一函数与同一正则跑 fixture 已确认：**正常文章只要含 "Cloudflare" 公司名或 "CAPTCHA" 术语就判 true，真实挑战页也判 true**，两种输入无法区分。中文维基百科等条目也可能受此规则影响；**未采集原始 HTML 之前，这 7 条都不能认定是 WAF 拦截。**
- `UNSUPPORTED_CONTENT_TYPE` 那条的成因不是"页面不是 HTML"，而是**响应体根本没被读取**：`fetchPageBody` 只在"响应 OK 且 Content-Type 属于 html/text/feed/pdf/docx/csv 之一"时才读 body，Content-Type 为空时直接返回 `body: ''`（`url-reader.ts:674-688`）；随后 `isHtmlContentType('')` 为 false，于是落到 `UNSUPPORTED_CONTENT_TYPE`（`url-reader.ts:1955-2023`）。也就是说，这条记录不足以判断页面类型或实际拦截原因。
- 12 条里没有一条附带原始 HTML 或响应头，因此**任何"某某站点在拦我们"的说法都超出证据**；后续复核需要保留 `status`、`content-type`、挑战页片段（或至少前 512 字节）与最终 URL。

按处置看：`PARSE_EMPTY` 的两条更像 SPA 首页/列表页没有 Readability 主体，降级到搜索摘要即可；`HTTP403` 的两条优先按反爬或访问策略处理，不做同 UA 重试；`JS_CHALLENGE` 的 7 条要先用组合信号复核（见落地清单第 10 条），复核前不应把它们当作"需要更强反爬对抗"的证据，也不应据此调整抓取策略。

## 五、推荐方案

### 5.1 在总时限内分配预算

保留手动 30 秒、自动 18 秒的默认总时限。以下数值为建议初值，需用回放与站点样本测量调整。

- 先复用搜索响应中带明确来源的正文；没有可用正文时才抓目标页。
- HTTP 阶段最多 5 秒。确认需要客户端渲染后直接转浏览器，跳过重复 HTTP 与猜测 feed。
- 仅在不同请求头确有价值时，给 crawler 一次最多 3 秒的机会；启动前预留至少 8 秒给浏览器。
- feed 只尝试页面已声明的地址，总计最多 1.5 秒；会挤占有效后备阶段时跳过。
- 浏览器使用剩余时间，启动、导航、等待共同服从原总截止线。第三方提取服务作为可选替代路线，预留自身预算，不在浏览器耗尽时间后继续叠加。
- Wayback 单独用于历史事实，带回快照时间；实时问题不走该路线。

自动 18 秒预算下，5 秒 HTTP + 3 秒 crawler + 1.5 秒 feed + 8.5 秒 browser 已占满全部理论时间，还需扣除编排开销。因此实现必须动态检查剩余时间，跳过收益低的阶段，不能强求所有步骤执行。手动 30 秒余量更多，同样保持总截止线。

### 5.2 分类 → 动作（可直接落成枚举）

```text
STATIC_OK        → deliver(content)
JS_RENDER        → browser once → ok? deliver : SNIPPET_ONLY
WAF_CHALLENGE    → browser once（真实 UA + 等待）→ ok? deliver : SNIPPET_ONLY(reason=anti_bot)
GONE             → historical question? wayback(with archivedAt) : UNAVAILABLE
PAYWALL / LOGIN  → UNAVAILABLE(reason=auth_required)，不要用存档冒充
TIMEOUT / BUDGET → 一次降级，不重试
BROWSER_MISSING  → UNAVAILABLE(reason=renderer_unavailable)，并提示部署侧安装 Chromium
```

### 5.3 每类问题该给模型什么

- 失败的 `errorCode` 之外，补一句**动作语义**：例如"站点启用了反爬验证，已尝试浏览器渲染失败，请引用搜索摘要并说明无法核实原文"，而不是把 `JS_CHALLENGE` 这个内部码直接甩给模型。
- 成功但来自存档：必须写"以下内容来自 Wayback 快照 <timestamp>，不是当前页面"。
- 成功但来自摘要：必须写"以下为搜索摘要，未取得原文"。

### 5.4 不夸大的覆盖率预期

以下情形即使做完上面全部改造仍会失败，产品文案不应承诺"能读所有网站"：

- 托管挑战升级为交互式验证/验证码、或对数据中心 IP 直接拒绝；
- 需要登录、订阅、付费墙、地域授权的内容；
- 纯客户端渲染且接口需要签名/鉴权的 SPA；
- 站点对第三方提取服务同样封禁（此时 Tavily 会进 `failed_results`、Exa 会 `statuses=error`、Jina 会返回错误页）。

可承诺的是：**分类透明、按预算降级、错误可追踪，明确区分正文、摘要与历史快照**。

## 六、落地清单（网页读取部分）

1. **删除 Google Cache 阶段**：`url-reader.ts:1476-1520` 的 `fetchGoogleCache` 与 `:1789-1799` 的调用；官方已下线，实测返回 JS 中间页。若短期不删，至少加"命中挑战特征即判负"，避免把中间页当正文。
2. **Wayback 带时间戳**：`fetchWaybackMachine` 读 `closest.timestamp`，加进 `UrlReadResult`（如 `archivedAt`），并在 `formatUrlContentForModel` 与工具事件里输出。
3. **引入阶段预算**：把单一 `budget.remainingMs()` 拆成每阶段上限，browser 保底 8s。这是后备浏览器可能失去运行时间的原因之一。
4. **feed 改为声明式发现**：删除 6 个路径猜测（`url-reader.ts:1601-1616`），只跟进页面里声明的 `alternate` feed，并给 1.5s 上限。
5. **自动读取补浏览器配置**：`web-search-handler.ts:1051-1057` 未传 `enableBrowser`/`renderWaitMs`/`browserExecutablePath`，与手动读取（`url-reader-handler.ts:177-187`）不一致；未传配置时仍可能使用底层默认浏览器，但不会遵循完整的显式配置。
6. **错误码→动作映射**：在 `formatUrlContentForModel`（`url-reader.ts:2364-2375`）与自动读取的 evidence 里补 `kind` 与 `nextAction`。
7. **扩大搜索正文复用**：`web-search-handler.ts:980-990` 目前只复用 DeepSeek 正文；Tavily `raw_content`、Exa `text` 同样可用（需先评估 token 预算，复用前按字符数门槛过滤）。
8. **可选：接入第三方提取层**：按 key 与计价开关决定是否启用 Tavily Extract / Exa `/contents` / Jina Reader；每轮设调用次数上限，只在本地链失败后触发。
9. **软 404 检测（防误报）**：对"删除/不存在/404"特征做一次轻量判定，避免把"文章已删除"页当正文。
10. **挑战判定换成组合信号**：把"整页 HTML 关键词匹配"降级为辅助证据，主判据用响应头/挑战页结构/状态码与正文可得性三者组合；同时让"Content-Type 缺失但 body 是 HTML"走 HTML 解析分支。这两处直接决定 12 次失败里有多少是真实站点故障。

## 七、验证与局限

已核对的官方原文：

- Tavily Extract 参数、`failed_results`、HTTP 200 可能全失败、深度与超时默认值、错误码 400/401/429/432/433/500：<https://docs.tavily.com/documentation/api-reference/endpoint/extract.md>
- Tavily 计费（失败不计费、每 5 个成功 URL 计费）：<https://docs.tavily.com/documentation/api-credits.md>
- Exa `maxAgeHours` 全表、`livecrawl` 迁移表、`livecrawlTimeout` 默认 10000ms/上限 90000ms、`statuses[].source`、搜索前 10 条附带 contents 不额外收费：<https://docs.exa.ai/reference/contents.md>、<https://exa.ai/docs/reference/get-contents.md>
- Exa 计费口径（$1/1000 页/每种内容类型）：<https://docs.exa.ai/reference/pricing.md>
- Jina Reader 引擎、超时、缓存、代理、流模式、速率表与平均延迟：<https://jina.ai/reader>
- Google 官方更新记录（2024-09-24 `cache:` 操作符不再工作；2024-10-02 缓存链接功能已不可用）：<https://developers.google.com/search/updates>
- Wayback availability API 语义与返回结构：<https://archive.org/help/wayback_api.php>
- Cloudflare 挑战机制与拦截页行为：<https://developers.cloudflare.com/cloudflare-challenges/>、<https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/>

本次只读实测（2026-11-16）：

- `GET https://webcache.googleusercontent.com/search?q=cache:https://example.com` → HTTP 200，返回 92,861 字节的 Google 搜索中间页（含 `/httpservice/retry/enablejs` 重试链接），**不是缓存正文**。
- `GET https://archive.org/wayback/available?url=example.com` → HTTP 200，返回 `archived_snapshots.closest`（含 `timestamp`/`status`/`url`）。

局限与未验证项：

- 线上日志证据受限：工具元数据只保留 toolLogs 前 10 项、错误缓冲仅 5 条。本报告只能引用"12 次失败的程序分类分布"（7 `JS_CHALLENGE` / 2 `PARSE_EMPTY` / 2 `HTTP403` / 1 `UNSUPPORTED_CONTENT_TYPE`），无法逐站复核真实原因；尤其是 `JS_CHALLENGE` 由整页关键词匹配得出，误判概率不低（见 4.7）。报告中所有站点名都只表示"被这样分类过"，不表示"已确认是该类故障"。
- 任务描述中提到的"36kr 文章已删除"线索未取得证据，未纳入本报告。
- Google Search 官方 updates 页在本次环境中经 `curl` 直连返回 200 且可解析（该页正文是判断缓存能力下线的依据）；换用 `web_fetch` 时报的是抓取工具的 HTTP 404，属于工具侧问题，不作为站点不可用的证据。
- 生产环境的实际生效超时（`url_reader_timeout` 的系统设置值）未核实；报告只描述默认值与可配置范围。
- 未调用任何付费接口；Tavily / Exa / Jina 的成本结论全部来自官方计费文档与算术换算，不含实测账单。
- 未评估前端展示层如何呈现这些分类；若要把"历史快照/摘要/反爬"显式化，需要前端同步改动。

## 八、与既有研究的关系

- 搜索层参数与正文开关的官方对齐结论见 `docs/research/2026-11-14-web-search-api-conformance.md`（Tavily `include_raw_content`、Exa `contents.text`/`summary`、Metaso `includeRawContent`、DeepSeek `need_content`）。本报告在此基础上只讨论"搜索拿到正文之后，正文抓取失败该怎么收口"，不重复其参数结论。
- 本报告不含架构决定，暂不需要 ADR；若采纳"删除 Google Cache + Wayback 带时间戳 + 阶段预算"，属于行为变更，建议按 ADR 流程记录一条"正文抓取分层与时效标注"的决定。
