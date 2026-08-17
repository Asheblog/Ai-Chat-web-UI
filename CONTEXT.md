# AIChat — 领域词汇表

## 消息与对话

- **Message（消息）**：对话中的一条发言，由 Meta（元数据）和 Body（内容体）组成
- **MessageMeta**：消息的元数据，不含内容。包含角色（user/assistant/compressedGroup）、推理状态、时间戳、token 速度
- **MessageBody**：消息的内容体，包含正文、推理文本、工具事件、生成图片、工作区附件等
- **Stable Key**：消息的稳定标识符，用于去重、持久化和缓存键

## 文件上传

- **Drag Upload Surface（拖拽上传面）**：用户将本地文件拖入聊天输入区域时触发上传意图的交互区域；它只表达上传意图，具体归类由文件类型与当前能力决定
- **Image Attachment（图片附件）**：用户随消息上传、供视觉模型直接理解的图片材料
- **Workspace File（工作区文件）**：会话中的用户上传文件，作为工具可读取的工作材料；不同于图片附件和 RAG/知识库文档
- **Workspace File State（工作区文件状态）**：工作区文件在上传流程中的用户可见状态，用于区分上传中、可使用和失败
- **Recommended Analysis Type（推荐直接分析类型）**：产品明确提示可优先用于对话分析的常见文件类型（图片、PDF、Word、Excel、CSV、TXT/Markdown、JSON、代码文件等）；它不是上传白名单，不排除其他 Workspace File 的上传
- **Workspace Docker Run Slot（工作区 Docker 运行槽）**：进程内限制同时运行的 workspace Docker 容器数量的配额单位；聊天、Battle 与 Skill 沙箱共用同一池，超额请求排队等待
- **Orphan Workspace Container（孤儿工作区容器）**：执行超时或进程中断后仍留在宿主上、继续占用资源的 workspace 沙箱容器；系统须按命名前缀主动回收

## 思考与推理

- **Reasoning（推理/思考）**：模型在生成最终回答之前的内部思考过程，以文本形式暴露给用户；推理通道不含工具进度文案
- **CoT（Chain of Thought，思维链）**：模型逐步推理的过程。主聊天 / 分享 / Battle / Android 均按 Reasoning Offset 将推理与工具拆为平铺步骤流（每个节点独立卡片）
- **Reasoning Offset**：工具调用在推理文本中的字符偏移位置；用于将工具事件插入对应推理段落之间，形成步骤流（Start/End 由后端与流式层写入）
- **Reasoning Text**：推理的文本内容，流式传输；展示前可对历史污染行做剥离，但 offset 切片始终基于原始文本
- **Cot Timeline（平铺 CoT 时间轴）**：四端统一的过程展示；Web `CotTimeline` 与 Android RN `CotTimeline` 均由 `@aichat/shared/cot-timeline` 的 `buildInterleavedCotNodes` 构建节点，并直接渲染为消息体的一级兄弟卡片；左侧带状态色时间轴轨道，顶部提供统一「全部展开/全部折叠」开关（覆盖全部卡片，个体交互后退出统一态）；每张卡片独立折叠，Web 侧按消息/工具实例持久化（`aichat.cot_reasoning_visibility` / `aichat.cot_tool_visibility`），不再共享「深度思考过程」总壳；列表 key 由 `cotTimelineNodeKey` 生成（推理段仅按 `charStart` 稳定，避免流式增长 remount 打字机）

## 工具调用

- **Tool Event（工具事件）**：一次工具调用的完整生命周期记录，包含工具名、状态、参数、结果等
- **Tool Call Source**：工具来源 — builtin（内置）、plugin（插件）、MCP、workspace（工作区）、system
- **Tool Call Phase**：工具调用阶段 — arguments_streaming → pending_approval → executing → result/error/rejected/aborted
- **Tool Timeline（工具时间轴）**：消息内工具调用事件按时间/offset 排序后的序列；在步骤流中与推理段穿插排列，并可按 web_search/read_url 合并为工具组
- **Tool Node（工具节点）**：步骤流中的单个工具步骤，展示类型图标、标题、状态与可展开的参数/结果；四端均为独立平铺卡片
- **Tool Group（工具合并组）**：将同一 offset 下相关的搜索/读取调用合并展示，展开后显示各子调用明细
- **History List Tool Event Projection（历史列表工具事件投影）**：`GET .../messages` 分页列表对 Tool Event 的只读投影——去掉 `hits[]` 与大体量 `details`，保留 CoT 折叠/分组所需字段（含 `hitsCount`）；列表路径以 `history-list` 模式解析 `toolLogsJson`（不物化 hits）；`richPayload` 仍用含证据图字段的事件构建后再投影；单条 progress/by-client 读路径保持完整事件
- **Session Usage Lightweight Read（会话用量轻读）**：切会话不再请求重型 `/usage`（含 Tokenizer）；侧栏用量来自 `/sessions/usage` 缓存；`/usage` 默认仅 SQL aggregate totals + last_round，`includeContext=1` 才计算 context token

## 流式协议

- **Stream Chunk（流式块）**：服务端 execution SSE 与 legacy 事件经统一归一化后的客户端产物，web / mobile 共用 `@aichat/shared/chat-stream-contract` 类型定义
- **Stream Normalizer（流式归一化器）**：`@aichat/shared/chat-stream-parser`，将 SSE 帧与事件归一化为 Stream Chunk 的单一实现，web 与 mobile 不得各自维护解析副本
- **Tool Event Normalizer（工具事件归一化器）**：`@aichat/shared/tool-events`，ToolEvent 状态推断、合并、排序与中文摘要的单一实现，battle 与 chat 共用
- **Stream Message Reducer（流式消息归约器）**：`@aichat/shared/stream-message-reducer`，将 Stream Chunk 增量合并为消息 content / reasoning / ToolEvent 的单一实现，web 与 mobile 的流式状态更新只允许在此处维护归约规则
- **Battle Stream Event（乱斗流事件）**：Battle 专有的 `BattleStreamEvent` 协议，与 ChatStreamChunk 不同，battle 私有 SSE 循环不并入 chat 解析器

## 搜索

- **Web Search（联网搜索）**：通过外部搜索引擎（tavily、brave、exa、metaso）检索网页；在各引擎能力范围内默认请求/解析结果配图（Tavily `include_images`、Exa `contents.extras.imageLinks`、Brave `thumbnail`、Metaso `imageUrl`/`thumbnail`），再经识图筛选；支持可选 `scope`（含 `image`）：Metaso 走图片域、Brave 调用独立图片搜索 API，Tavily/Exa 仍以网页结果中的配图为主；`scope=image` 时跳过自动读正文，但仍对 hit 配图做识图相关性筛选并把相关/弱相关图回传模型
- **Read URL（网页读取）**：抓取并解析指定 URL 的正文内容；会抽取页面候选图，并在图片转写代理就绪时做识图相关性判定
- **Auto Read（自动读取）**：搜索完成后自动触发网页读取，读取搜索结果中的网页。在 UI 中归入其所属的搜索合并组内部；同样走网页图识图筛选
- **Web Evidence Image（联网证据图）**：经识图判定为「相关 / 弱相关」后进入助手答案的网页配图；无关图丢弃，不进入答案区与模型主证据；来源包括搜索 hit 配图、图片域搜索结果与读页抽取图
- **Evidence Stack Layout（上文下图）**：含联网证据图时，助手消息采用正文在上、相关图片横排在下的 `stack` 布局（`data-render-mode=evidence-stack`）；AI 生图仍可用侧栏并排
- **Illustrated Research Report（图文研究报告）**：深度研究最终 Markdown 可在正文嵌入经筛选的证据图；`export_pdf` 可选 `images` 参数仅下载模型声明的公网图片 URL，内嵌为 `data:` URL 写入 HTML/PDF（figure/figcaption），禁止 PDF 渲染时任意外联远程图
- **搜索批次**：同一轮搜索任务下发起的搜索调用集合，在工具区块内合并展示
- **并行搜索**：多个搜索引擎同时查询，属于同一批次

## 密钥

- **Secret Vault（密钥库）**：由显式主密钥保护、加密保存用户或管理员私有凭据的系统边界；密钥值只允许写入和运行时使用，不允许对普通用户回显或跨能力继承；系统级模型连接密钥允许管理员在受控管理面导出与导入，用于环境迁移
- **System Connection Export（系统连接导出）**：管理员将系统级模型连接的供应商配置与明文 API Key 打包为可下载文件的操作；仅用于环境迁移，不属于普通列表回显
- **System Connection Import（系统连接导入）**：管理员将导出包写入目标环境系统连接的操作；按端点签名合并，对已有明文 Key 去重追加，不删除目标环境既有连接

## 视觉与品牌

- **Design Tokens（设计令牌）**：Web 端统一的结构与语义视觉变量，包括字号阶梯、控件高度、间距、圆角与默认 Claude 气质色板；由 `globals.css` / Tailwind 持有，页面不得再使用随意 `px` 字号或随意覆盖按钮高度
- **Flat App Canvas（扁平应用画布）**：主聊天、登录/注册、Settings、Battle、分享页共用同一暖色 `--background` 作为整页底；禁止对角斜纹装饰、多层纸感渐变，以及「白卡套在灰底上」的套娃表面；`--surface` 与画布同色，`--card` 仅用于可交互分组（设置卡、表格等）的轻量边框面
- **Chat Column（对话栏）**：主聊天与分享正文居中，最大宽度由 `--chat-max-width`（默认 90rem / 1440px，沿用改造前消息区宽度）约束；桌面 composer 取 `min(对话栏, 视口减去侧栏余量)`；Welcome 首屏输入区保持更窄的 940px；移动端仍为满宽加边距，不受该上限影响
- **Conversation Stream（对话流排版）**：助手消息通栏正文、无重面板；用户消息为轻量圆角淡底块（非气泡卡片）；工具/深度思考为低调折叠区，不以重阴影卡片抢阅读焦点
- **Reading Anchor（阅读锚点）**：同标签页内按会话记住的当前阅读消息（`stableKey`）；刷新后恢复到该消息顶部附近，并与侧目录高亮共用同一状态
- **Turn TOC（轮次目录）**：主聊天右侧悬浮的对话轮次导航；以用户提问摘要（及压缩组占位）为目录项，滚动时高亮当前轮，点击跳转到对应用户消息
- **Brand Theme（品牌主题）**：管理员可覆盖的品牌视觉变量子集（主色、主色前景、画布背景、表面、前景、次要前景）；未配置时使用 Claude 默认暖色主题；不可覆盖字号、间距、圆角等结构 Token；布局气质跟 Claude，色板仍服从 Brand Theme
- **Brand Theme Injection（品牌主题注入）**：客户端将 Brand Theme 写入根节点 CSS 变量的过程；与 light/dark 类切换正交，暗色模式仍使用暖暗配套默认值，仅在管理员提供覆盖值时改写对应变量

## 设置

- **Settings Center（设置中心）**：用户管理个人设置与管理员管理系统设置的统一入口
- **System Settings（系统设置）**：仅管理员可访问的系统级配置集合，用于管理模型、连接、能力、运行策略、治理审计和维护项
- **Settings Top-Level Group（设置顶级分组）**：系统设置左侧导航的一级分组（模型与连接 / 功能与工具 / 成员与安全 / 系统与数据 / 高级设置），把相关设置页面组织在同一操作语境下；「概览」为独立顶级叶子
- **Settings Page（设置页面）**：顶级分组下的具体配置页面，是右侧内容区渲染的最小页面单位；共 13 个（概览、供应商与连接、模型管理、图片转写、搜索与知识库、工具与扩展、MCP 管理、用户与注册、Skill 治理、品牌与界面、日志与审计、数据与维护、推理与网络）
- **Feature Card（功能卡）**：设置页内的白话化配置卡片（图标 + 标题 + 白话描述 + 主开关 + 常用项 + 「更多参数」折叠），默认折叠高级参数；来自 `components/settings/components/feature-card.tsx`
- **Vision Transcription Proxy（图片转写代理）**：主模型不支持识图（vision）时，将用户消息中的图片自动交给管理员指定的识图模型转写为文字描述的系统能力；由系统设置「图片转写代理」开关（默认关闭）+ 连接 + 模型配置，作用于所有用户；同一转写模型也用于联网证据图的相关性判定（相关 / 弱相关 / 无关）
- **Image Transcription（图片转写）**：指定识图模型将图片附件转换为文字描述的过程；结果持久化到用户消息的 imageDescriptions 字段，后续轮次直接复用（转写一次）
- **Visual Analysis Tool（视觉分析工具）**：内置工具 `analyze_visual_media`，仅在主聊天流处于工具流且主模型无 vision 时注入；主模型可自主多次调用，描述以工具结果回传并随工具事件持久化；工具流下会向前缀注入「用户附件」提醒（含张数），引导主模型先调用该工具再回答
- **Web Image Relevance Filter（网页图相关性筛选）**：爬虫/搜索抽到候选图后，先启发式去掉 logo/过小图，再调用识图模型判定与页面/查询上下文是否相关；仅相关与弱相关写入 `assessedImages` 并进入 Rich Payload / 答案区

## 深度研究计划确认

- **Research Plan Approval（研究计划确认）**：深度研究模式执行搜索前必须先提交 `research_plan` 工具调用并等待用户确认的交互流程；用户可开始研究、调整计划（最多 2 次重审）或取消
- **Research Plan Card（研究计划卡）**：Web 端 CoT 时间轴顶部的特殊只读/可交互卡片，展示研究标题、目标、子问题与关键词、预计工具轮数和交付物；等待审批时提供操作按钮，历史/分享场景只读
- **Research Plan Approval Registry（研究计划审批注册表）**：与当前 SSE 流同生命周期的内存审批注册表，按 `sessionId + toolCallId` 登记待审批计划，由 `/chat/stream/research-plan/respond` 消费；不落库、不跨断线恢复
- **Research Plan Revision（研究计划修订轮次）**：用户提出调整后模型重新生成计划的次数；0 为初版，最多 2 轮调整，第 2 轮后只允许开始或取消
- **No-search Deep Research Fallback（无搜索深度研究降级）**：深度研究被启用但无可用搜索引擎时，先由后端合成 `research_plan` 选择卡让用户选择“基于已有知识继续 / 取消”；继续后直接生成标注未联网的报告，不进入计划确认

## 移动客户端

- **Android Client（Android 客户端）**：AIChat 的可安装 Android 应用，以移动端原生交互访问既有 AIChat 服务端；它不是 Web 客户端的简单网页壳
- **Server Endpoint（服务端地址）**：用户在 Android 客户端内配置的 AIChat 服务端根地址，客户端所有 API 请求都以它为基址
- **Mobile Chat MVP（移动端聊天 MVP）**：Android 客户端首版范围，仅覆盖服务器配置、认证、会话列表和聊天主流程；不包含系统设置、MCP、Skill、知识库管理、Battle、任务追踪或管理员后台
- **Mobile Auth Token（移动端认证令牌）**：Android 客户端保存并用于 API 请求的 Bearer token；不同于 Web 客户端依赖的浏览器 cookie
- **Mobile Release Identity（移动端发布身份）**：由 Android applicationId 与长期 release signing certificate 共同确定的可升级应用身份；同一发布链路必须持续使用相同身份
- **Mobile Release（移动端正式发布）**：与 `app.json` 版本一致、由 `mobile-v<versionName>` Tag 触发并使用移动端发布身份签名的可分发 APK

## Skill

- **System Skill（系统级 Skill）**：对所有拥有权限的用户可见且可用的 Skill
- **User-private Skill（用户私有 Skill）**：归属于单个注册用户的 Skill，仅对该用户可发现和可用，其他用户不可见
- **Skill Owner（Skill 所有者）**：拥有用户私有 Skill 的已登录且处于可用状态的注册用户；匿名用户不能成为 Skill 所有者
- **Skill Identity（Skill 身份）**：系统分配给一项已安装 Skill 的稳定身份，用于准确引用和校验其归属
- **Skill Slug（Skill 标识名）**：供用户识别、搜索和展示的可读名称，不承担运行时唯一身份
- **Skill Package（Skill 包）**：内容不可变且不包含用户状态的 Skill 文件集合，相同内容可以被多个独立安装引用
- **Managed Skill Dependency（受管 Skill 依赖）**：由 Skill 版本预先声明并锁定、通过受控构建过程安装的运行依赖
- **Skill Dependency Environment（Skill 依赖环境）**：为特定 Skill 版本和运行平台生成的不可变依赖集合，不与宿主机全局环境混用
- **Installed Skill（已安装 Skill）**：已加入某个用户私有 Skill 集合、可供该用户选择的 Skill；已安装不代表已在任何会话启用
- **Session-enabled Skill（会话启用 Skill）**：已绑定到一个特定聊天会话、仅在该会话中可被选择和运行的已安装 Skill
- **Pinned Skill Version（会话固定 Skill 版本）**：会话启用时选定的具体 Skill 版本，不随用户私有库中的版本升级而自动改变
- **Skill Runtime Workspace（Skill 运行工作区）**：一次 Skill 运行可写入的隔离空间，其内容不与其他用户或会话共享
- **Skill Version（Skill 版本）**：内容身份稳定、可被独立评估和管理的一份 Skill
- **Approved Skill Version（已批准 Skill 版本）**：获准运行的特定 Skill 版本；其批准不延伸到同一来源的其他版本
- **Instruction-only Skill（纯指令型 Skill）**：只提供说明、知识或工作流程，不包含可执行代码、运行时依赖或额外权限的 Skill
- **Executable Skill（可执行型 Skill）**：包含脚本、运行时依赖或额外权限，能够在模型指令之外执行操作的 Skill
- **Skill Sandbox（Skill 沙箱）**：可执行型第三方 Skill 的强制隔离运行边界，不允许降级为宿主机直接执行
- **Skill Capability（Skill 能力）**：可执行型 Skill 明确声明的一类运行访问权限，未声明的能力默认不可用
- **Skill Capability Grant（Skill 能力授权）**：授予特定 Skill 版本的一组已批准能力，不延伸到其他版本或未声明的访问范围
- **Skill Secret Requirement（Skill 密钥需求）**：Skill 版本声明的命名密钥需求，只描述用途和名称，不包含密钥值
- **Skill Secret Binding（Skill 密钥绑定）**：Skill 所有者将自己的私有密钥关联到已安装 Skill 的关系，仅供获批版本按已声明名称使用
- **Skill Visibility（Skill 可见性）**：Skill 的可发现与可用范围属性，至少区分系统级与用户私有两种级别
- **Curated Skill Source（可信 Skill 源）**：由系统管理员认可并维护、允许用户无需人工审核即可安装其中 Skill 的第三方来源
- **Custom Skill Source（自定义 Skill 源）**：由用户提交且尚未获得系统管理员认可的第三方 Skill 来源；其中的 Skill 在获得认可前不可运行
- **Skill Source Status（Skill 来源状态）**：来源是否参与商店同步、新安装和更新的状态；停用来源不改变用户已经安装的 Skill
- **Skill Store Index（Skill 商店索引）**：系统从 Skill 来源同步并保存的可发现 Skill 快照，供用户在来源暂时不可用时继续浏览
- **Skill Store Item（Skill 商店项）**：商店中可被独立选择和安装的单个 Skill；批量安装仍由多个独立商店项组成
- **Skill License Status（Skill 许可证状态）**：系统依据 Skill 的明确许可条款判定其是否可以直接安装的合规状态
- **Skill Compliance Baseline（Skill 合规基线）**：系统内置并持续维护的可信来源、受管依赖源和强制阻断规则集合；满足基线只代表允许安装，不代表获得可执行权限
- **Skill Resource Quota（Skill 资源配额）**：限制单个用户可安装数量、逻辑存储占用、并发运行和依赖构建数量的资源边界；超额不删除已有数据
- **Skill Uninstallation（Skill 卸载）**：移除 Skill 所有者的安装、配置、密钥和会话启用关系，同时保留既有消息与执行审计

## MCP

- **MCP Server（MCP 服务）**：通过 Model Context Protocol 暴露外部工具、资源或提示的服务；不同于 Skill，MCP 服务不是模型指令或工作流程本身
- **Remote MCP Server（远程 MCP 服务）**：已由第三方或管理员运行、通过网络端点接入的 MCP 服务；普通用户只能直接连接这类 MCP 服务
- **Local Package MCP Server（本地包型 MCP 服务）**：需要系统安装并启动的软件包形式 MCP 服务；只能由管理员安装为系统级能力
- **MCP Gateway（MCP 网关）**：系统用于托管本地包型 MCP 服务进程、隔离运行边界并代理 MCP 调用的服务边界
- **MCP Installation（MCP 安装）**：MCP 服务加入系统级或用户私有集合的元数据记录；它提供可配置模板，已安装不代表任何用户或会话可调用
- **MCP Connection（MCP 连接）**：用户或系统基于 MCP 安装创建的连接实例，保存普通配置、密钥绑定、连接状态和启用状态；连接是 MCP 服务可调用的最小配置单位
- **System-shared MCP Connection（系统共享 MCP 连接）**：管理员显式允许多用户共同调用的系统级 MCP 连接，使用系统级配置和密钥并受配额与审计约束
- **MCP Binding（MCP 绑定）**：将 MCP 连接在系统、用户、会话或 Battle 模型范围内启用或禁用的关系
- **MCP Tool Runtime（MCP 工具运行时）**：首版 MCP 运行链路，仅包含工具发现、工具调用和工具清单变更处理
- **MCP Tool Cache（MCP 工具缓存）**：系统从 MCP 连接读取并保存的工具清单快照，用于展示、搜索和调用校验
- **MCP Tool Set Revision（MCP 工具集版本）**：MCP 连接工具清单快照的稳定版本，用于判断会话启用时看到的工具集合是否已经过期
- **MCP Tool Identity（MCP 工具身份）**：由 MCP 连接和原始工具名共同构成的稳定工具身份；原始工具名不能单独作为系统内唯一标识
- **Pinned MCP Tool（固定 MCP 工具）**：被用户或管理员选中并允许直接暴露给模型的 MCP 工具
- **MCP Progressive Discovery（MCP 渐进发现）**：模型先通过轻量搜索和详情查询发现 MCP 工具，再按名称调用目标工具的方式
- **MCP Policy Boundary（MCP 策略边界）**：管理员定义的 MCP 最高允许范围，决定来源、连接、工具类别或调用是否允许进入运行时
- **MCP Runtime Confirmation（MCP 运行时确认）**：当前会话用户在敏感 MCP 工具调用前进行的允许或拒绝决策
- **MCP Global Gate（MCP 全局总闸）**：管理员控制 MCP 能力、来源或安装是否可被使用的最高优先级开关；用户和会话不能绕过全局总闸
- **MCP Secret Binding（MCP 密钥绑定）**：用户或管理员将私有凭据关联到已安装 MCP 服务的关系；凭据只用于对应 MCP 服务连接或调用
- **MCP Registry Source（MCP 注册表来源）**：提供 MCP 服务发现、版本和安装元数据的外部来源，包括官方注册表、市场和组织自建目录
- **Built-in MCP Market（内置 MCP 市场）**：系统内置的 MCP 服务发现目录，聚合远程 MCP 服务、仓库链接、主页和安装元数据；出现在市场中不代表已获准运行
