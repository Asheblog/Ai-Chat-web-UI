# 聊天输入区与模型 / 思考强度实施计划

> 用户已审阅并批准；采用 subagent-driven-development，逐任务实施与独立审查，完成后合并 main 并推送。

**目标：** 在分支 `feat/chat-composer-model-effort` 实施用户确认的完整 Figma 输入区设计，验证后合并 main 并推送 origin，检查相关 GitHub Actions。

**设计依据：** [设计说明](../../design/chat-composer-redesign.md)、[竞品研究](../../design/chat-composer-reference-research.md)、[Figma 双端主稿](https://www.figma.com/design/tbkaIC3w5FVZrawBKs8BYb/Untitled?node-id=1-2)、[模型与强度](https://www.figma.com/design/tbkaIC3w5FVZrawBKs8BYb/Untitled?node-id=5-558)、[状态与强度选项](https://www.figma.com/design/tbkaIC3w5FVZrawBKs8BYb/Untitled?node-id=5-837)。

## 已确认的范围与约束

- 保持 Ink & Mist 设计系统。输入区顺序为附件、编辑文字、已启用能力、底部操作栏；额度在框外。底部入口为附件、工具、模型与强度、发送 / 停止。
- 桌面模型菜单宽 288px，常规模型行至少 48px；名称、来源、勾选分别表达身份和状态。长名称换行，统一搜索保留目录顺序和连接级唯一键。
- 同一个胶囊显示模型名与强度；手机可用短模型名，强度始终可见，发送保持完整点击区域。手机控件至少 44px。
- 模型菜单底部进入强度页，保留 unset / low / medium / high / max / xhigh；默认对应 unset。调整强度后返回模型列表。组合用法选模型后保留面板以继续设置；关闭或 Esc 恢复焦点和草稿。纯模型旧调用保留原来的选择即关闭行为。
- 思考强度沿用现有设置和提交含义；深度思考开关仍独立。无后端、数据库、模型目录或模型能力推断变更。
- 工具面板收纳思考、联网、深度研究、Python、知识库、Skill / MCP、会话提示词、请求头与任务追踪；移除重复的强度入口。桌面锚定面板，手机“能力 / 上下文与设置”底部面板。
- 已启用能力用可操作标签回显；手机最多两个标签，其余 +N。联网标签可到达搜索范围，思考标签可到达组合强度设置。
- 保留附件选择、图片、粘贴、拖入、上传状态、移除 / 重试、全屏编辑、输入法保护、额度、发送 / 停止以及既有权限、禁用和编辑锁定条件。
- 当前检出直接使用新分支；保留已有未跟踪文件，只提交本次实现、明确使用的设计资料和验收记录。Figma 示例模型名不进入生产目录。

## 当前证据

- 工作目录 E:/codebase/aichat；改造分支已创建，已跟踪代码无未提交改动。
- 起点提交 1be5d491；远程 main 的固定初始 merge-base 为 fafdfa2a1eccdb5415c2db5c73fa8b38be430ee5。最终审查另取当时的 merge-base 并固定到具体提交。
- 前端基线：pnpm --filter @aichat/frontend exec vitest run，2026-11-15 运行完成，退出码 0。
- Windows 命令用 PowerShell 7。浏览器验收用项目 dev server + Playwright，截图落在 output/playwright/。

## Task 1：紧凑的模型与强度组合选择器

**文件：** 修改 packages/frontend/src/components/model-selector/ 下的 types、panel、hook、trigger、header、list、row、search-controls 与现有测试；按职责新增 model-selector-effort.tsx；修改 chat/composer-model-actions.tsx 及其测试。

**接口：** 在 model-selector-types.ts 导出 ModelReasoningEffort（六值联合）和 ModelReasoningControl（value、onChange、可选 disabled）；ModelSelectorProps 增加可选 reasoningControl。ComposerModelActions 接受并透传该可选控制。旧调用不需要提供它。

- [x] 先扩展现有行为测试：模型与强度同时回显；六值选择调用 onChange；unset 显示默认；组合模式选模型保持面板；普通模式仍选择即关闭。
- [x] 覆盖来源搜索、同名连接唯一选择、长名称、加载 / 无结果 / 错误重试、Esc / 焦点、禁用回调，确认新增断言先失败。
- [x] 实现 288px 桌面向上菜单及空间翻转、手机底部面板；标题与搜索固定、列表独立滚动、底部强度入口和同面板返回。复用现有 Popover / Sheet / 模型查询能力。
- [x] 运行该目录与 composer-model-actions 测试，修复后提交本任务代码。不要将示例模型或默认 Max 写进状态。

## Task 2：工具面板与已启用能力标签

**文件：** 在 packages/frontend/src/components/chat/ 新增 composer-tools-panel.tsx 与 composer-active-capabilities.tsx（必要时分出小的纯展示子组件）；修改 composer-toolbar-primitives.tsx、plus-menu-content.tsx 的相关旧入口及受影响测试。复用 skill-panel-sheet.tsx 和既有对话框。

**接口：** ComposerToolsPanel 导出类型化 props，接收现有能力值 / 回调 / 可用条件及上下文动作；用 open、onOpenChange 控制；手机含能力与上下文页签。ComposerActiveCapabilities 接收 active 条目（id、label、icon、onActivate）及 mobile；手机最多两个、桌面默认三个可见条目，+N 打开面板。由集成调用方传递真实状态与既有动作。

- [x] 先写行为测试：能力切换、受限原因、知识库与 Skill / MCP 入口、提示词 / 请求头 / 任务追踪；手机页签；两个标签加 +N；不存在重复强度入口。
- [x] 实现面板和标签，保留独立附件入口；减少旧 flat 控件重复，清理失去调用的展示代码。纯模型 / 其他页面使用的入口按真实调用关系保留必要契约。
- [x] 联网标签进入既有范围控制，思考标签交给组合选择器；维持各能力独立状态与可用条件。
- [x] 运行工具和标签测试，修复后提交本任务代码。

## Task 3：双端输入区与全部调用方集成

**文件：** 修改 chat/desktop-composer.tsx、mobile-composer.tsx、composer-shell.tsx、composer-shell-styles.ts、composer-attachment-list.tsx 中需要匹配稿的布局，及 app/globals.css 中相关 token / 尺寸；核对 chat-composer-panel.tsx、features/chat/welcome/WelcomeHero.tsx 与实际调用链；更新对应现有组件和 hook 测试。

**接口：** 现有 DesktopComposer / MobileComposer 的消息、附件、能力及状态回调继续工作；将已有 effort / onEffortChange 映射给 Task 1 的 reasoningControl。Task 2 面板使用已有开关、权限、上下文动作。避免创建第二套偏好状态。

- [x] 先更新回归断言：入口顺序、启用状态回显、额度在框外、空输入禁用、创建中 / 生成中 / 停止、全屏、粘贴 / 附件移除及错误重试、输入法发送保护。
- [x] 实施四层输入区，空行收起；手机 44px 操作，模型可截断、强度和发送不被挤出。桌面和手机复用工具及模型控制，保留已有草稿、权限和锁定规则。
- [x] 检查 Welcome、会话页面和其他共用选择器调用方，特别是无当前会话或无模型回调的用法；保持它们原有可用条件。
- [x] 运行受影响测试、前端全套测试、type-check、lint、build 和 architecture:check；只有改动相关失败和既有失败被定位并处理后才进入交付。文件行数与工程结构沿用现有规范，不扩展无关架构。
- [x] 更新 model-selector/README.md、CONTEXT.md / CONTEXT-MAP.md 必要条目；以新的 ADR 记录“模型与强度配套、工具收纳、单列搜索”的边界，引用并明确替代 ADR-0043 中相应模型选择条款。

## Task 4：真实页面验收、审查、合并与推送

- [x] 加载 ui-ux-pro-max、playwright 和 verification-before-completion；用项目既有命令启动本地 dev server，复用有效的本地环境。Playwright 在该 dev server 验收实际页面；测试数据可经可复现网络 fixture 注入，截图说明数据来源。
- [x] 覆盖 /main 与 /main/[sessionId]，宽屏、390px、375px；默认 / focus / hover / disabled、模型及强度页、搜索 / 同名连接 / 长名称、loading / empty / error、工具页签 / 能力 / Skill-MCP、附件 / 上传失败、全屏、生成中 / 停止。同步检查控制台、资源请求、可见焦点、滚动 / 遮挡 / 安全区；修复实际发现的偏差并复核。
- [x] 保存截图和简明验收记录，说明真实服务与 fixture 的覆盖。复用同一候选的有效检查结果。
- [x] 用 code-review 对 git merge-base origin/main HEAD 得到的固定 BASE 和候选 HEAD 做 Standards / Spec 双轴审查；逐项裁决和修复影响本次契约的问题，必要时重跑对应检查。
- [ ] 只暂存本次文件，完成提交。fetch 后核对主分支最新状态，处理冲突并验证合并结果，合并 main，推送实现分支和 main（不强推）。
- [ ] 检查此次推送触发的 GitHub Actions，镜像构建或必需检查失败则定位、修复、再次推送并跟踪到结论。交付分支、提交、主分支合并结果、检查和截图位置。

## Review Focus

优先检查模型连接级身份、强度六值及 unset 的含义，旧纯模型入口的关闭条件；组合选择与工具面板是否只迁移入口而没有丢失功能、权限或编辑锁定。检查手机 +N、375px 模型与强度 / 发送共存、浮层焦点与键盘、附件错误恢复；避免 mock 测试通过但实际 dev 页面溢出或层级错误。生产目录与示例模型数据分离。合并和推送只包含本次范围，保留其他工作区资料。
