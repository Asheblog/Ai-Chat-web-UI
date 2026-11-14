# Process Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 按已审稿Figma落实Web过程工作区、真实调用台账、历史一致投影与停止工具继续作答。

**Architecture:** 保留ToolEvent.id及现有调用入口，新增共享操作投影与明确coverage。后端独立处理持久化和运行控制；前端使用消息级工作区宿主，分享与Battle复用只读内容。shared接口先冻结，再并行实施，主代理负责集成与浏览器验收。

**Tech Stack:** TypeScript、React/Next、Zustand、Radix、Tailwind、Hono、Jest、Vitest、Playwright。

**Spec:** [Approved implementation contract](../specs/2026-11-14-process-workspace.md)；原始设计来自 Figma mqPJdKkA6O1Krf1ULsWRwz，主要节点5:1978、2:81、3:1355、3:1508、6:3264；实施裁定与 ADR-0044 优先于原型中的未支持控件。

## Global Constraints

- 在当前独立worktree实施；用户已于2026-11-14批准完成后commit、合并主分支、push并监督CI。复用现有tokens与公共组件，Windows宿主使用PowerShell7。
- 业务数据不是Figma示例：台账从真实消息工具事件生成，来源从已知hits/正文引用生成，缺失标未知。保留旧存储数组读取以支持现有消息数据，不保留过时UI实现。
- 失败操作数按唯一记录计数；受影响父调用数按根去重。父调用、子任务、尝试、阶段和生命周期更新使用不同标签，禁止相减推算。
- 不把error等同于未获许可/中止/已降级；覆盖缺口与执行结果分开。未知关系、覆盖、尝试次数不显示为0或伪造完整。
- 既有披露偏好、reasoningOffset、稳定消息键、分享只读及Battle模型隔离保留。模型实际返回的推理/摘要才可展示。
- 单文件尽量≤300行；新增模块分离数据/视图/交互。变更先写失败测试，使用项目脚本定义green。
- 正文回答、附件下载、研究计划审批、整轮取消保持其原有入口和含义；不以重生成冒充单次工具重试。

## Review Focus

1. 同id重复/乱序事件、相同callId不同子记录、缺失父节点：不重复计数、不吞子事件、不虚构父节点。
2. 错误后fallback/retry、未获许可与中止：状态与最终影响独立显示。
3. 512KB日志压缩、旧数组、分享/Battle历史：身份关系和覆盖保留，所有读取方同步迁移。
4. 停工具与整轮取消竞态、停止发生在工具运行中、预算耗尽：停止后无新工具，仍可作答；真正取消不触发额外模型请求。
5. 移动/键盘/长中文/长JSON/数百调用、虚拟列表卸载：可读可操作，返回原阅读位置，不让日志淹没答案。

## Task 1 — Shared operation projection（独占：packages/shared）

**Files:** src/tool-operations.ts（新增，必要时分为identity/index/summary模块）、src/tool-events.ts、src/chat-stream-contract.ts、package.json；测试沿现有backend/frontend消费者测试放置独占新文件。

**Interfaces（冻结后发给下游）:** 生产ToolOperationIndex（records/roots/children/orphans）、ToolOperationSummary（parentCalls/subtasks/failedOperations/affectedParentCalls/rejected/aborted/degraded等明确单位）、ToolLogCoverage（trace/persisted/projection分别含status:complete|partial|unknown、asOf?/startedAt?/turnEndedAt?/droppedRecords?/truncatedFields?）、来源去重投影。id始终记录主键；operationId如引入只作派生别名，不能用callId合并不同id。derive outcome只使用确证字段，禁止从英文错误文本猜状态。parentCallId按父callId唯一匹配连接；无匹配orphan，多匹配ambiguous且不归入任一children。无attempt证据不展示次数。

- [x] 用父子/孤儿/重复事件/回退/旧数据写失败测试并观察失败。
- [x] 实现共享纯函数、字段和exports，定义端到端coverage字段名并立即交接。
- [x] 用项目测试、shared build验证，报告修改路径/接口/测试结果。

## Task 2 — Persistence and history（独占：backend日志与查询/分享投影）

**Files:** modules/chat/tool-logs.ts、tool-log-manager.ts及测试；modules/chat/services/message-query-service.ts、services/shares/share-service.ts、services/battle/battle-share-projector.ts及对应测试。若agent-web-search-response.ts需要改变recordToolLog，交由Task3唯一所有者按接口补接。

**Interfaces:** serializeToolLogsForPersistence保持返回string|null；新持久化信封含v/entries/coverage；parseToolLogsJson仍向现有调用方返回条目，另提供coverage解析/投影，所有消息读取路径一致透出toolLogCoverage。coverage.persisted.status三态；丢记录或裁剪字段为partial，各自记录droppedRecords/truncatedFields；旧数组coverage为unknown。trace与projection独立，绝不从持久化推断trace完整。

- [x] 为字段保留、旧数组读取、受限预算丢记录、marker不碰撞、历史/分享/Battle一致性写失败测试。
- [x] 统一记录字段，按层压缩保留身份、父子、最终状态、来源、时间与coverage。
- [x] 所有读取方同步迁移，legacy缺失coverage为unknown；修复不再创建伪成功compacted条目。
- [x] 运行tool-logs/message-query/share/Battle相关测试、后端type-check。

## Task 3 — Stop tools and final answer（独占：后端编排与流控制）

**Files:** agent-runtime/tool-orchestrator.ts及测试、tool-protocol.ts、services/chat/stream-meta-store.ts、modules/chat/routes/stream.ts和control.ts、agent-web-search-response.ts、chat-common.ts及对应测试；API文档由主代理集成。

**Interfaces:** POST /api/chat/stream/stop-tools，目标与cancel相同、校验当前用户与活动run；返回accepted及目标/原因。单独stopTools标志，不设置cancelled、不abort整轮。编排器可选shouldStopTools，预算或停止后最多一轮无工具收尾；调用方接新状态。Battle调用者按是否启用新选项保持明确语义。

- [x] 为停止/预算耗尽/取消优先/完成后重复请求/不存在目标/权限隔离写失败测试。
- [x] 实现停止标志、路由及回执；若支持pending标记需限制目标和生命周期，禁止影响后续run。
- [x] 固定协议：不中止在途工具；已派发但未执行的tool_calls补tool结果占位与stage=result/status=aborted，随后最多一轮无工具收尾，不留下未配对消息。
- [x] 当前工具自然结束后不再派发下一工具；真正取消优先立即退出。onBudgetExhausted:finish|error默认error，仅chat选择finish，Battle保持原预算语义。收尾轮不携带tools；仍返回tool_calls只标未执行，不再请求。无正文保留已有内容并用明确“未生成最终回答”的运行结果反馈，不伪造模型回答；streamStatus仍使用现有枚举。
- [x] 删除无调用方的假成功/api/chat/stop并修文档；接Task2记录接口，保留所有工具字段。
- [x] 运行编排器/stream-state/路由/研究计划审批测试、后端type-check。

## Task 4 — Process workspace and ledger（独占：前端工作区模块）

**Files:** features/chat/process-workspace/*、features/chat/call-ledger/*（可合并为单一深模块）、对应Vitest测试；不直接改chat-store。UI设计遵循已定Figma与ui-ux-pro-max。

**Interfaces:** ProcessWorkspace消费真实message、ToolEvent[]、coverage、readOnly、可用commands；自身保存tab/selectedOperation/filter，仅运行宿主提供动作时显示可执行控件。侧栏440px，≥1440双栏、768—1439覆盖、<768全屏。台账是当前消息全宽视图，不偷换为全局task-trace诊断页。

- [x] 写工作区打开关闭、焦点、tabs、父子展开、异常定位、检索/筛选/空态/未知覆盖测试。
- [x] 实现过程任务树、分离推理摘要、调用详情/原始参数/有证据的尝试、来源去重外链、产物元数据与下载、全宽真实台账。引用定位因缺少正文锚点映射不显示；不把可下载描述成可内联预览。
- [x] 使用Radix Sheet/Dialog完成覆盖模式焦点锁定/Esc/还焦点；每容器单滚动，历史查看暂停跟随并可回到最新。
- [x] 对无真实operation retry的工具提供明确现有操作（如重新生成整轮）或无可执行按钮；研究计划仅接真实审批，不新增所有工具审批体系。
- [x] 覆盖长中文/JSON、数百调用、移动触摸、空/加载/失败、只读分享和多模型隔离的组件测试。

## Task 5 — Host integration, verification, docs（主代理独占接缝）

**Files:** components/message-bubble/cot-timeline.tsx及必要入口、components/chat-interface.tsx、chat viewport/row props、share-viewer/Battle详情、features/chat/api/streaming.ts及消息类型/水合接缝、dev预览路由/Playwright脚本；CONTEXT.md、必要ADR、frontend/backend README与实施记录。

- [x] 先写接缝测试：现有摘要入口打开工作区，真实message定位，分享/Battle复用且命令隔离，旧披露偏好迁移/返回位置保留。
- [x] 接Task1/2/3/4产物；正文产物不重复且下载入口保留；接真实stop-tools回执与运行态反馈。
- [x] 从主仓复制必要设计截图与汇总供验收；Trace97原始文件存在才制作脱敏逐条回放，否则使用明确标为合成压力夹具的数据。454最终记录与378生命周期更新不同口径，不混为完整原始记录。
- [x] 项目完整frontend test/backend test/shared build/type-check/lint、架构与行数检查；基线失败单列，不用改断言掩盖。
- [x] 项目dev命令启动本地服务，真实浏览器截图宽/窄屏及运行、完成、异常、审批、原始详情、来源/产物/台账、分享/Battle；检查交互、资源和控制台。
- [x] 新上下文审查Standards+Spec，修复实质问题后补验受影响检查；更新术语与必要ADR，交付可用分支、运行入口、截图和真实缺口。

## Parallel ownership and execution

Task1先冻结契约；Task2/Task3可并行但agent-web-search-response.ts只由Task3写。Task4按冻结契约独占新前端模块，Task5主代理独占现有宿主接缝，双方接口先约定。每项实现者新上下文、独立审查；已有三个scout仅提供勘查，不能算独立实现审查。测试/构建使用受管理后台job，控制并发，避免Next输出和端口冲突。

用户已批准实施、合并main与push触发CI。采用subagent-driven-development：契约冻结后持久化、执行控制与工作区并行，主代理统一集成；真实浏览器与独立审查通过后提交、合并、推送并监督CI。
## Implementation Rulings

- Ruling: shared纯函数通过backend现有Jest消费者测试并先build shared，不新增测试依赖 — shared当前无test script，复用真实项目入口 — 错判代价为移动少量测试。
- Ruling: 本轮无单次工具重放/通用工具审批；展示已有研究计划审批与“整轮重新生成”，只显示证据支持的尝试 — 不把不同操作偷换成相同含义 — 后续若需通用重放需单独明确幂等语义。
- Ruling: 分层覆盖各自三态，压缩字段和丢记录分别计量 — 旧数据未知不能变成完整，丢字段不必然丢记录 — 错判代价为误导台账口径。


- Ruling: 来源清单序号不作为正文 citation 身份，当前仅外链；产物提供元数据和真实下载，不承诺缺少渲染器支持的预览 — 保持接口真实能力 — 错判代价为误导用户定位或预览。
- Ruling: Battle详情只在原对话框内联展开过程；存储裁剪只影响coverage，runtime truncated仍表达执行降级；重复question键的coverage仅唯一匹配展示 — 以观测证据保护语义 — 不扩大为既有Battle身份模型重构。

## Release protocol

Final frontend regression passed: 158 files / 945 tests. Commit the reviewed implementation and documentation, fast-forward main, verify the merged tree, then push main and supervise quality gates and all three Docker image builds. Release evidence is recorded with the delivered commit and Actions run.
