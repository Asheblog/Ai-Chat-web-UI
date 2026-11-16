# 追踪详情空白、导出不完整与联网正文读取失败：诊断记录

用户提供的截图与 #105 导出显示两类独立故障：追踪链路丢失或隐藏诊断数据；搜索命中后，部分网页正文读取失败。优先修复日志持久化与错误可见性，再优化正文读取，才能用完整证据判断抓取质量。

调查日期：2026-11-16。本文保存实施前的诊断，源码行为与行号以基线提交 `18e1253963906faa9b0a539e74150ec6da1b715f` 为准；后续改造见[实施规格](2026-11-16-web-retrieval-redesign.md)与[部署说明](../deploy/web-retrieval.md)。

## 已确认的证据

输入：

- 用户截图：#104 列表事件数 2001，详情显示“暂无事件”；多个记录停在 2001。
- 用户提供的 #105 导出（原始记录未入库）：任务 completed，执行 148077 ms，结束于北京时间 10:51:18.872。
- 用户补充的 1Panel 容器日志（原始记录未入库）：509 行，记录容器启动、12 次网页读取失败，以及旧追踪详情/导出请求。
- 当前仓库源码：链路行为与导出的主要症状一致；生产镜像版本及实际挂载状态尚未采集。

### #105 在任务结束前约 77 秒停止记录

解析得到 2001 条事件，末条在北京时间 10:50:01.610，类型 `trace_overflow`，内容 `maxEvents: 2000`。任务结束时间比末条记录晚 77.262 秒。

| 事件类型 | 条数 | 意义 |
| --- | ---: | --- |
| `sse:dispatch` | 1296 | 高频流式内容/推理分片 |
| `db:persist_progress` | 495 | 进度持久化摘要 |
| `tool:event_buffer` | 100 | 工具日志缓冲摘要 |
| `tool:event` | 100 | 本文件中全部仅剩 `type: tool_call` |
| `agent:provider_request` | 6 | 模型请求 |
| `request:init`、`http:client_request`、`agent:activated`、`trace_overflow` | 各 1 | 请求与截断标记 |

前两类共占 1791/2001，约 89.5%。记录器在全局序号到达 2000 后仅追加一次 overflow，随后所有事件都被丢弃，工具错误与最终结束事件也受同一上限约束。见 [task-trace.ts:189](../../packages/backend/src/utils/task-trace.ts#L189)。

这是**写入阶段的丢弃**。详情页面前 2000 条的显示限制是另一层机制；导出读取全部已保存事件，也补不回没有写入的后半程。页面“完整记录请使用导出功能”的提示因此只适用于展示截断。见 [TaskTraceDetailSections.tsx:137](../../packages/frontend/src/components/task-trace/TaskTraceDetailSections.tsx#L137)。

### 缺失文件被显示成正常空数据，导出仍返回成功

数据库保存追踪元数据与 `eventCount`，详情及导出从 `logFilePath` 对应的 NDJSON 文件读事件。

- 路径为空或 `access()` 失败时，文件服务返回 `{ events: [], truncated: false }`，丢失缺失、权限等状态；非法 JSON 行也被直接跳过。见 [task-trace-file-service.ts:23](../../packages/backend/src/services/task-trace/task-trace-file-service.ts#L23)。
- 详情 API 在事件为空时显式将 `truncated` 设为 false，仍返回 `success: true`；前端于是显示“暂无事件”。见 [task-trace API:75](../../packages/backend/src/api/task-trace.ts#L75)。
- 导出 API 不检查数据库事件数与实际可读数，照常构造头部、metadata 和空 Events 段，以 HTTP 200 返回附件。见 [task-trace API:95](../../packages/backend/src/api/task-trace.ts#L95)。

已通过当前真实文件服务与导出函数复现缺失文件场景：0 条事件、`truncated=false`，生成 195 字节文本，末尾只有 `--- Events ---`。真实记录的 metadata 更长时，同样路径可以生成几 KB 的小文件。

#104 生产文件为何读不到尚未直接确认。当前机制已经证明：小文件和“暂无事件”均可由同一个缺失文件条件触发，无需假设浏览器下载被截断。

### 默认日志路径与 Docker 持久化卷不一致

记录器依次使用 `TASK_TRACE_LOG_DIR`、`LOG_DIR/task-trace`、`process.cwd()/logs/task-trace`。见 [task-trace.ts:147](../../packages/backend/src/utils/task-trace.ts#L147)。

当前标准部署中：

- [Compose:78](../../docker-compose.yml#L78) 挂载 `/app/logs`。
- [Supervisor:9](../../docker/supervisord.conf#L9) 以后端 `/app/packages/backend` 为工作目录。
- [启动脚本:12](../../packages/backend/docker/start-backend.sh#L12) 声明 `LOG_DIR="/app/logs"`，但没有显式 export；Compose 中也未向进程传入 `LOG_DIR` 或 `TASK_TRACE_LOG_DIR`。

**若镜像或部署没有额外导出覆盖值**，Node 写入的是 `/app/packages/backend/logs/task-trace`，落在容器可写层，未进入 `/app/logs` 持久化卷。重建容器时数据库可保留追踪记录，事件文件却丢失。普通进程重启与容器重建有不同后果。

容器日志进一步支持该候选：本次容器于北京时间 10:44:17 启动后端；截图 #104 创建于 08:52，属于此次启动前的记录，详情空白；#105 创建于 10:48，属于此次启动后的记录，能导出事件。日志中旧记录 #104、#101、#99 的导出与详情请求仍返回 200（第 428–459 行），符合文件缺失被吞成正常成功的代码路径。该时间线支持文件未持久化或路径变化，但单次启动本身不能证明容器重建，也未直接显示生产文件位置。生产结论还需比较实际进程环境、数据库 `logFilePath` 与文件所在卷。后续纠正路径前，先复制现存容器层文件到持久化卷并核对记录，避免重建时进一步丢失；旧数据库中的绝对路径也需要迁移或明确解析规则。

### 工具事件记录丢失了最需要的错误细节

`sendToolEvent()` 将规范化事件交给 `summarizeSsePayload()`。实际 `type` 为 `tool_call`，摘要函数却只在 `type === tool` 分支保留 tool、stage、query、error。见 [agent-web-search-response.ts:478](../../packages/backend/src/modules/chat/agent-web-search-response.ts#L478) 和 [task-trace.ts:326](../../packages/backend/src/utils/task-trace.ts#L326)。

这解释了 #105 的全部 100 条 `tool:event` 为什么只有 `{ type: tool_call }`。另一份 `tool:event_buffer` 只保留 tool、stage 和缓冲数量，没有具体 URL、错误码或各阶段耗时。

结束 metadata 使用通用 `sanitizePayload()`，数组只取前 10 项；#105 `toolEvents: 82`，`toolLogs` 实际只有 10 项。见 [task-trace.ts:38](../../packages/backend/src/utils/task-trace.ts#L38)。因此该导出足以证明 CNBC 错误，但不足以恢复其他失败网页的完整原因。

## 联网搜索与网页正文读取需要分别判定

#105 中 Tavily 和 Exa 搜索均有命中结果；前两次搜索自动读取分别记录为 2/2、1/2。可见证据中：

- CNBC 正文读取返回 JavaScript challenge，随后退回搜索摘要。
- 网易文章有正文结果；雪球记录了爬虫回退成功。
- 5 条 `tool:event_buffer` 的 stage 为 error。它们是保留下来的错误事件标记，不代表已经掌握 5 个独立网站的故障原因，也不能推算整次任务失败率。

用户补充的容器日志提供了更完整的错误分布：

| 程序错误码 | 次数 | 对应页面 |
| --- | ---: | --- |
| `JS_CHALLENGE` | 7 | CNBC、TradingEconomics、中文维基、tastymoney、东方财富两条、澎湃 |
| `PARSE_EMPTY` | 2 | 腾讯 stockapp 首页、富途新闻列表 |
| `HTTP_403` | 2 | Investing、TradingKey |
| `UNSUPPORTED_CONTENT_TYPE` | 1 | 财联社详情页，响应 Content-Type 为空 |

这里统计的是 12 次读取失败，没有成功读取总数，不能据此计算失败率。容器日志未出现追踪写入失败、ENOENT 或权限错误；缺失文件被静默吞掉的机制，使“没有错误日志”也不能证明文件存在。

任务 `completed` 表示模型执行结束，不代表所有工具成功、正文完整或信息实时。

### 当前回退链路的具体薄弱点

1. **阶段共用时间，但缺少阶段预算。** 手动读取默认 30000 ms，搜索自动阅读默认 18000 ms。native、crawler 和同源 feed 的请求使用全部 `remainingMs()`。一个慢请求即可吃完总预算，后续浏览器或 DeepSeek Fetch 不会开始。现有 [deadline 测试:130](../../packages/backend/src/utils/__tests__/url-reader.test.ts#L130) 已明确描述 native 超时后不再回退；它验证总截止线成立，没有证明后备引擎有机会运行。
2. **六个猜测的 feed 地址排在浏览器前。** `/rss/`、`/feed/`、`/rss.xml` 等逐一尝试；没有阶段上限时，收益较低的探测会挤占正文渲染时间。见 [url-reader.ts:1601](../../packages/backend/src/utils/url-reader.ts#L1601)、[url-reader.ts:1884](../../packages/backend/src/utils/url-reader.ts#L1884)。
3. **自动阅读没有传递完整浏览器配置。** 手动调用传入 enableBrowser、browserExecutablePath、renderWaitMs、maxBodyBytes；自动阅读只传 timeout、内容长度、DeepSeek 开关与 key、signal。见 [手动调用:177](../../packages/backend/src/modules/chat/tool-handlers/url-reader-handler.ts#L177) 与 [自动调用:1051](../../packages/backend/src/modules/chat/tool-handlers/web-search-handler.ts#L1051)。自动阅读会落回底层默认值，设置与实际行为可能不一致。
4. **浏览器失败没有准确分类。** 浏览器缺失、启动失败、无正文等情况主要折成 null，再记录为 skipped，外层 JS challenge 等原始错误可能掩盖真正的浏览器失败。建议保留 `BROWSER_UNAVAILABLE`、启动错误、渲染超时与仍为验证页的具体状态。
5. **验证页检测可误判正常文章。** `detectJsChallenge()` 在整份 HTML 中匹配 7 个关键词正则，其中包括单独的 `cloudflare`、`captcha`，发生在正文提取前。用原始函数与原始正则回放：正常技术文章只要提到 Cloudflare 公司名或 CAPTCHA 术语，两项均返回 true；真实挑战页对照也返回 true。该诊断回放保留于调查工作区，后续固定回归见 [challenge.test.ts](../../packages/backend/src/utils/web-retrieval/__tests__/challenge.test.ts)。因此 7 次 JS_CHALLENGE 仅是程序标签，实际站点返回内容仍需逐页复核。
6. **缺失 MIME 导致正文在读取前被跳过。** `fetchPageBody()` 在 Content-Type 为空且 URL 不像已支持文件类型时，直接返回空 body；之后判为不支持。财联社日志符合此路径，但未保留其响应体，不能断言它实际是 HTML 或确实不可读。应在大小受限的前缀内判断类型，再决定是否按 HTML 解析，保留既有响应体上限和跳转规则。见 [url-reader.ts:674](../../packages/backend/src/utils/url-reader.ts#L674)。
7. **缓存与当前正文混在一个默认链路。** Google Cache、Wayback 仍在回退路径内，DeepSeek Fetch 放在这些本地回退之后；需要按来源有效性与时效性重新评估。行情、价格等实时问题应优先结构化实时来源，历史网页不应计为当前行情的成功证据。

Google 官方已确认 [cache: 操作符与缓存链接下线](https://developers.google.com/search/updates)，应删除 Google Cache 阶段。Exa [当前文档](https://docs.exa.ai/reference/contents.md)已将 `livecrawl` 废弃，改用 `maxAgeHours`；Tavily [Extract 文档](https://docs.tavily.com/documentation/api-reference/endpoint/extract.md)要求同时处理 `results` 与 `failed_results`，HTTP 200 不代表所有页面成功。

见配套[网页提取服务官方资料研究](web-fetch-provider-findings-2026-11-16.md)。

## 推荐实施顺序及验收

| 优先级 | 修改 | 验收信号 |
| --- | --- | --- |
| P0 | 将追踪目录绑定到持久化卷；保存并迁移现存文件与旧路径 | 容器重建前后的同一条 trace，详情与导出事件一致 |
| P0 | 文件服务返回可读、缺失、读取错误、损坏、部分可读等明确状态，API 与页面展示对应原因 | 数据库 2001 条但文件缺失时不再显示正常“暂无事件”；导出返回明确失败或明确标注的不完整结果 |
| P0 | 合并高频分片与进度记录，关键工具/错误/结束事件保留；写入截断和展示分页分开 | 2000 条噪声后，工具错误与结束事件仍能查询、导出；省略数量可见 |
| P0 | 修正 tool_call 摘要字段，关键工具日志走有明确字段的持久化，保留错误码、URL、attempts 与耗时 | 第 11 项及以后的错误仍可追踪；metadata 的省略明确可见 |
| P0 | 验证页改用结构与正文可得性的组合信号；缺失 MIME 做受限类型识别 | 正常文章提到 Cloudflare/CAPTCHA 仍能读；真实挑战页不被当正文；缺 MIME HTML 和二进制分别正确处理 |
| P1 | 手动读取和自动阅读共享同一配置解析；保持各自既定总时限 | UI/环境开关与自动阅读行为一致，调用取消仍及时生效 |
| P1 | 总时限内划分 HTTP、渲染与可选服务预算；feed 限量、限时且优先读取页面已声明地址 | 第一个 HTTP 或 feed 慢响应时，仍有预留时间运行有效后备阶段 |
| P1 | 复用已有搜索正文，按错误类型选择本地渲染或可选提取服务；限制同 URL 重复请求 | 缓存命中不重复抓取；404、验证页、超时与额度错误走不同处理 |
| P1 | 实时行情优先结构化数据，网页作为解释来源；摘要与历史快照分别记录类型、时间 | 历史快照/摘要不计入当前正文或实时报价成功率 |

建议先完成 P0 再评估提取服务，不先新增付费依赖。现有搜索正文复用分支仅接受 DeepSeek 来源；建议沿用其接口扩展至具有正文来源标记的 Tavily raw_content 和 Exa text，保留提供方、读取时间与内容质量依据，不把 snippet 或 summary 当全文。提高 `maxEvents` 可临时延缓截断，但会继续受高频分片影响，并增加文件与内存开销。

以上是建议方案，尚未改变项目现有事件计数、成功率指标或接口契约。实施时需明确 `eventCount` 表示已持久化、已接收还是展示条数；保持现有调用的数据含义，另增省略/截断字段，避免用新指标掩盖数据丢失。

## 诊断回放与修复验证

实施前在隔离内存 fixture 中加载真实文件服务、导出函数、记录器及摘要函数，得到四项红色结果：缺失文件状态被吞掉；tool_call 错误字段被丢失；82 项工具日志只保留 10 项；上限后的工具错误与结束事件被丢弃。回放 eventCount=2001、lastEvent=trace_overflow。验证页检测另有两个正常文章用例失败，一个真实挑战页对照通过。

本机临时回放脚本与用户原始日志未入库。修复后的可复核用例在 [task-trace 记录器测试](../../packages/backend/src/utils/__tests__/task-trace/task-trace-recorder.test.ts)、[详情与导出 API 测试](../../packages/backend/src/api/__tests__/task-trace.test.ts)、[文件服务测试](../../packages/backend/src/services/task-trace/task-trace-file-service.test.ts)及[网页提取测试](../../packages/backend/src/utils/web-retrieval/__tests__/html-document.test.ts)。

诊断阶段未直接检查生产数据库、容器挂载与文件系统，因此文件丢失的具体时间和可恢复范围仍需在部署环境确认。实施验证与本地实时抽样单独记录，避免把后续结果混入原始诊断。
