# 前端性能修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 subagent-driven-development（推荐），或用户选择的 executing-plans。各任务按失败测试、实现、验证、提交和审查推进。

**Goal:** 修复已确认的 Worker 故障、流式卡顿、输入牵连渲染、首屏阻塞及其余审查问题，回归通过后合并 main 并推送。

**Architecture:** 保留 Next 14 / React 18 / Zustand 结构与现有视觉规范。Worker 作为有握手、截止时间和有限恢复的渲染服务；消息按行订阅，输入与正文隔离；壳层稳定显示，重功能按权限和操作加载。

**Tech Stack:** Next 14.2.5、React 18.3.1、TypeScript、Zustand 4、TanStack Virtual、unified/remark/rehype、Vitest、Playwright Chromium、pnpm 8.15.0。

**Spec:** 本文“设计与验收约定”为已诊断缺陷的修复规格，不引入新业务功能。

## 状态与授权

- 用户已授权全部修复、建分支、按流程实施、合并 main 和推送；不再次请求这些动作的授权。
- 分支 codex/frontend-performance，起点 fdc02221，创建时 main 与 origin/main 距离 0 / 0。
- 用户已批准本计划；Task 1–6 已实施，Task 7 的测试、双轴审查和最终生产浏览器 smoke 已通过。移动输入框额外回归已修复并通过增量审查。
- 完整前端 vitest（105 文件 / 583 测试）、独立 tsc、生产 build 已通过，日志见 `output/playwright/frontend-performance/final-{vitest,tsc,build}.log`。
- 实现提交146f83bc，首次合并提交14e92689；修复分支与main已推送，git ls-remote核对远端一致。后续验收记录提交同样随修复分支合入main。
- 不改生产账号设置、不发线上测试聊天、不自行改部署配置。浏览器回归使用本地生产构建与合成消息。

## 设计与验收约定

### A. Markdown Worker 与流式渲染

- 根治生产 Worker 依赖选择 browser 解析器而调用 DOMParser 的问题。显式解析纯 JavaScript 入口，不编辑 node_modules、不枚举 pnpm 内部目录。若需新增直接依赖，使用现有传递依赖锁定版本并同步 pnpm-lock.yaml。
- 加 ready 握手，初始化预算 3 秒、任务预算 5 秒；集中常量，依据生产回归调整时记录理由。error/messageerror/postMessage throw/超时均结算 Promise 并清理 pending。任一渲染任务失败或超时会终止当前 Worker、结算全部 pending 并进入 10 秒冷却，冷却期内不新建 Worker；连续失败最多重建 2 次（首次创建之外），成功任务清零失败计数与冷却，shutdown 清理 pending、计时器和重试状态并重置本地上限，可重新建立服务。
- 保留同一追加链的最近 HTML，正文和渲染结果用版本区分。编辑、重新生成、ID 复用、会话切换必须失效；不能让其他内容的旧 HTML 闪现。
- 每消息只允许一个进行中的任务与一个最新待处理快照，流式沿用 280ms 节奏起点；完成、停止、错误立即请求最终快照，迟到响应不得覆盖最终版本。
- Worker 尚未产出或失败时安全显示完整纯文本与格式降级提示，不在每个 chunk 同步解析整篇 Markdown；恢复后显示完整格式、公式和代码块。
- 主聊天、分享、Battle 的公共渲染器一并回归；纯 reasoning 更新不重复解析空正文。

### B. 行订阅、输入与布局

- 主聊天行只订阅自身 body/cache/metrics；列表负责顺序、虚拟位置与稳定元数据，不能因一条正文更新重渲染全部历史行。通用只读场景继续支持外部消息数据，不能强绑主聊天 store。
- 稳定 variant/share props 和回调；metrics、不可分享集合、变体选择变化仍正确更新。分享摘要只观察选中消息工具事件，阅读目录只观察所需用户摘要。
- 输入状态局部化或建立有效 memo 边界，单字符输入不重渲染历史消息，流式正文不重算 composer 全套配置；日期格式化器复用，保留 locale/时区/跨天语义，不建无界缓存。
- 阅读导航 scroll/resize 每帧最多一次测量，缓存锚点并清理 rAF；保留历史 prepend 锚点、主动上滚、自动贴底开关和目录跳转。动态正文不改固定行高。
- textarea 读写隔离，尽量不反复改变真实输入框高度；宽度/字体变化重测；移除与自动高度冲突的 height 过渡。覆盖中文输入法、缩短、清空、粘贴、多行和溢出滚动。
- 折叠 CoT 只渲染当前和相邻行，保留 hover 暂停、结束停末行、展开全文、计时器清理。打字机和虚拟行测量合帧，不删除正文或阅读能力。
- TerminalCodeBlock 移至模块级并稳定 key/props；高亮轻量化与按语言加载，未知语言安全降级，避免完整 Prism 进入同步首包及复制焦点丢失。

### C. 壳层、设置、品牌与诊断

- SSR/水合首帧显示一致的非敏感壳和骨架，身份未就绪时禁用受限操作，避免 mounted=false 整页空白；不乐观展示敏感历史或管理功能。
- 有路由会话 ID 时，身份就绪后会话列表与目标消息尽可能并行，保留权限、竞态和空会话处理；无 ID 的默认选择仍依赖会话列表。
- SetupWizard 仅管理员按需加载，内部 SystemConnections 再分包；不对匿名/普通用户请求 setup-status，保留首次安装与身份切换语义。SettingsDialog 首次打开加载，个人叶子分包。
- 独立个人设置只挂激活页签，保留已有四个 hash 深链、back/forward、导航与弹窗隔离。未进入 Skills/Shares 不发列表请求。
- 侧栏复用日期格式化器并隔离/延迟搜索。当前每页默认 20 条，不为此引入无必要的复杂虚拟化。
- 服务端 branding 从 fetch 到响应体读取共用 1.5 秒 deadline，超时回默认品牌；保留 revalidate/no-store、theme 映射，请求内复用结果，不跨用户错误缓存。
- TitleSync 合并重复入口，保留 store in-flight 去重，有限退避、卸载清理和在线恢复；身份切换和管理员修改后可刷新。
- 生产保留必要 warn/error，不再全局吞掉 Worker/渲染异常；日志仅固定类别与必要状态，不包含消息正文、凭据或令牌。

## Global Constraints

- 复用暖色画布、Design Tokens、公共组件与页面密度，不新建视觉系统。主/子 UI 工作均使用 ui-ux-pro-max、quick-reference、pro-rules。
- UTF-8 无 BOM，兼容 Windows PowerShell 7 与 Linux 容器；不提交密钥、本地环境、node_modules 或构建产物。
- 锁文件恢复依赖，不随意升级，不改 npm 锁文件。迁移：无数据库/API 迁移，前端实现直接替换。
- TDD 先验证目标失败再实现；事实未变不重复检查。记录实际全部失败；生产 build 忽略类型错误不能替代独立 tsc。

## Review Focus

1. production Worker 解析、阻断 Worker、超时与 shutdown 都能结算、无 pending 泄漏。任务 1/2。
2. 连续追加、替换、版本重置、停止/错误、切会话和复用 ID 的旧结果不会污染新消息。任务 2。
3. loading/匿名/普通用户/管理员及账号切换时壳层、预取和向导不会越权。任务 4。
4. 长消息、prepend、CoT 开关、移动端中文输入不会跳位、丢字、截尾。任务 3/5。
5. 个人设置深链与回退、branding 悬挂响应体、重试卸载不会请求风暴或导航失效。任务 4/6。

## 执行归属

推荐主线程负责 Worker、缓存调度和 Markdown 强依赖链及集成；两个子工作包负责消息行/输入/滚动与壳层/设置/品牌。MarkdownRenderer、MessageBubble 渲染调度由主线写，交叉接口先约定，公共文档由主线程更新。最终独立 code-review 按 Standards + Spec 双轴审查。

## Task 1: 测试环境与 Worker 生产解析

**Files:** packages/frontend/next.config.js；src/workers/markdown-worker.ts；src/lib/markdown-worker-client.ts；相邻协议/纯解析入口；src/lib/__tests__/markdown-worker-client.test.ts。下列 src 均在 packages/frontend。

**Interfaces:** 保留 requestMarkdownRender(payload: RenderRequest): Promise<RenderResponse> 与 shutdownMarkdownWorker(): void；内部 ready/response 判别与任务 deadline。失败返回明确 errored 的安全响应，shutdown 取消行为测试固定。

- [x] pnpm install --frozen-lockfile 恢复完整依赖；若损坏包误判已存在，按错误定向恢复锁定版本，记录锁文件变化。
- [x] 失败测试：ready 前不发任务、永不 ready、任务无响应、error/messageerror/postMessage throw、迟到事件、shutdown、重建次数上界/成功恢复、同消息并发与 superseded。
- [x] pnpm --filter @aichat/frontend exec vitest run src/lib/__tests__/markdown-worker-client.test.ts 确认真正失败于目标行为，再实现。
- [x] 同一测试转绿，阶段提交 fix(frontend): recover markdown worker rendering。生产打包验收在任务 7，不用 MockWorker 通过代替。

## Task 2: 缓存、最新快照与安全降级

**Files:** src/features/chat/store/runtime/stream-buffer.ts；slices/message-slice.ts；src/components/message-bubble/index.tsx；相邻渲染调度 hook；src/components/markdown-renderer.tsx；message-body-content.tsx；相关 store/renderer 测试。

**Interfaces:** applyRenderedContent 验证版本和源内容；若新增 cache 来源字段，集中扩展类型并核实全部写入者。调度 hook 输入消息身份/正文快照/版本/streaming，输出显示 HTML/渲染状态。

- [x] 失败测试：flush 保留同源旧 HTML；48ms 持续追加仍产出 HTML；停止/错误请求最终版本；拒绝旧响应/替换/ID 复用；reasoning-only 不重算空正文。
- [x] renderer 失败断言：pending/失败大正文不调用整篇主线程解析；尾段始终可读；恢复格式正确；结果不触发请求循环。
- [x] 红灯后实现单 in-flight + 最新快照、缓存失效和纯文本降级。
- [x] pnpm --filter @aichat/frontend exec vitest run src/features/chat/store/__tests__/stream-slice.test.ts src/features/chat/store/__tests__/message-slice-edit.test.ts src/features/chat/store/__tests__/progress-resume-content.test.ts src/components/__tests__/markdown-renderer.test.tsx；并运行新增调度测试，转绿提交。

## Task 3: 行订阅与输入隔离

**Files:** src/hooks/use-chat-interface-viewmodel.ts、use-chat-composer.ts；src/components/chat-interface.tsx；chat/chat-message-viewport.tsx；message-list.tsx；新增行组件/相邻 hook；src/lib/utils.ts 与测试。

**Interfaces:** 稳定 key 的主聊天行订阅；share/Battle 外部只读数据保留独立路径。保持 MessageListHandle.scrollToStableKey 接口。

- [x] 失败 render-count 测试：单字符输入不重渲染历史行；末行 body/cache/metrics 变化不重渲染其他行；share/variant/metrics 改变正确更新。
- [x] 覆盖用户摘要、不可分享 research_plan、变体/压缩组/分页 prepend。红灯后实现选择器、稳定 props、composer/viewport 边界与日期复用。
- [x] 定向跑新增测试及 src/components/chat/__tests__/chat-composer-panel.test.tsx、desktop-composer.test.tsx、mobile-composer.test.tsx、src/components/share/share-viewer.test.tsx，转绿提交。与任务 2 的 MessageBubble 文件串行交接。

## Task 4: 首屏壳和按需设置

**Files:** src/app/main/layout.tsx、chat-page-client.tsx；src/hooks/use-main-bootstrap.ts；src/components/sidebar.tsx；setup-wizard/setup-wizard.tsx；settings/settings-dialog.tsx；personal-settings.tsx；src/app/main/settings/_components/settings-layout-client.tsx 与测试。

**Interfaces:** public shell 管布局，身份门管权限；个人页用共享小型导航协议沿用四个 hash 外部地址，与弹窗宿主隔离。

- [x] 失败测试：SSR/水合 loading 有稳定壳；匿名/普通用户无 setup-status；管理员首次安装仍打开向导；已知路由消息不等 sessions 返回。
- [x] 失败测试：profile 只挂 profile；hash 进入 skills、切 shares、back/forward 内容/导航一致；未打开弹窗无叶子挂载。
- [x] 实现骨架、权限就绪后并行加载、dynamic 分包、个人页按需挂载、sidebar 搜索/日期优化。
- [x] 跑 src/app/main/__tests__/chat-page-client.test.tsx、src/components/settings/__tests__/personal-settings.test.tsx、settings-dialog-search.test.tsx 及新增测试，转绿提交。

## Task 5: 布局、CoT 和代码块

**Files:** src/hooks/use-reading-nav.ts、use-scroll-persistence.ts、use-textarea-auto-resize.ts；src/components/chat/composer-shell-styles.ts；message-bubble/vertical-line-scroller.tsx、typewriter-reasoning.tsx、cot-timeline.tsx；message-list.tsx；主线写 markdown-renderer.tsx 与独立代码块组件。

**Interfaces:** useTextareaAutoResize 返回值与滚动 handle 保持；rAF/observer/计时器/异步高亮有清理与过期保护。

- [x] 失败测试：同帧多个 scroll 仅测一次、卸载取消、prepend 保锚、上滚不贴底；CoT 万行折叠 DOM 常数上界、hover 暂停/结束末行/展开全文；textarea 缩短/清空/换行/宽度重测。
- [x] 失败代码块测试：相同代码重渲染保持 DOM/复制焦点；未知语言安全降级；语言加载竞态不覆盖新代码。
- [x] 红灯后合帧测量、textarea 读写隔离、CoT 行窗口、稳定代码块与按需高亮；交叉文件串行写入。
- [x] 跑 src/features/chat/reading-nav/__tests__/reading-nav.test.ts、src/components/message-bubble/__tests__/vertical-line-scroller.test.tsx、cot-timeline.test.tsx、src/components/__tests__/typewriter-advance.test.ts、markdown-renderer.test.tsx 和新增 hook 测试，转绿提交。

## Task 6: 品牌 deadline 与错误可观测

**Files:** src/lib/server-branding.ts；src/components/title-sync.tsx、console-silencer.tsx；必要的 src/store/settings-store.ts；src/lib/__tests__/server-branding.test.ts 及新增 TitleSync/console 测试。

**Interfaces:** getServerBranding(): Promise<ServerBrandingResult>、品牌/theme 数据格式与存储键保持。

- [x] 失败测试：fetch 无响应与 json 悬挂均在 1.5 秒回退；正常主题/no-store/revalidate 保持；请求内复用。StrictMode 不重复请求，有限重试/卸载清理/恢复，生产保留 warn/error。
- [x] 红灯后实现共用 deadline、去重恢复和安全错误日志，定向转绿提交。

## Task 7: 集成、独立审查、合并与推送

**Files:** packages/frontend/scripts/performance-smoke.mjs 或等价独立验证脚本；更新 CONTEXT.md 记录渲染快照失效与设置导航规则。脚本不内嵌账号/生产消息。

- [x] pnpm --filter @aichat/frontend type-check；pnpm --filter @aichat/frontend exec vitest run。本次跨公共渲染/布局，完整前端套件是最小充分集成范围；记录全部既有/新增失败，不把 root backend test 当前端验证。结果：vitest 105 文件 / 583 测试全绿，tsc 无错误。
- [x] pnpm --filter @aichat/frontend build 后启动本地生产产物；真实应用入口请求 Worker Markdown/公式/中文代码，收到 ready 和有效 HTML，零 DOMParser/document 错误；阻断 Worker 验证降级与有限恢复。
  - 最终 build 与生产 smoke 均通过；深链首轮失败是夹具结构错误，已修正；移动端九行输入共享 ref 缺陷已补红测并修复。Windows standalone 启动仍有环境限制，见验收记录。
- [x] 同一设备/浏览器/窗口/数据对比修复前后：520 段约 2.4 万字符，25 次、48ms cadence；另测输入、设置打开、首次导航。录帧间隔、长任务、解析/行重渲染次数与首包 decoded/transfer bytes，不把合成输入延迟叫正式 INP。
- [x] 验收目标：Worker 完成且缓存非空；历史行不跟随每 chunk/输入重渲染；流式大正文无主线程整篇解析；同环境 frame p95 至少下降 50%。不达标继续定位，不单纯调大 flush。线上旧 p95 145.8ms 只作参考，不能跨环境直接算提升百分比。
- [x] 桌面/移动截图覆盖长正文、代码、公式、CoT、空/加载态、设置深链；回归停止/断流/切会话/历史恢复/分享/Battle，修复可见问题。
- [x] 固定 git merge-base origin/main HEAD，由独立 code-review 按 Standards + Spec 审查；处理所有 Critical/Important 和 Declined to judge，必要时定向补测。审查发现的 TitleSync 身份切换/online 接线、branding `use server` 常量导出与超时中止、侧栏日期缓存复用已按原负责人回归修复，定向测试全绿。
- [x] 检查 diff/编码/工作区，整理提交；fetch origin，main 若前进先集成，不 force。合并 main，确认合并树必要证据有效，推送修复分支与 main 并核对远端 HEAD；保留修复分支追溯。
- [x] 交付提交/分支/推送状态、测试命令结果、可比性能数据、审查结论和真实限制；不宣称未确认的线上部署或提速。

## 收口状态

范围、接口与验收已批准，实施、测试、双轴审查、截图与最终 smoke 已完成。同环境最终 frame p95 138.8 → 62.5ms，下降 55.0%；实现已提交，已合并 main、推送两分支并核对远端。完整证据与环境限制见同目录验收记录。
