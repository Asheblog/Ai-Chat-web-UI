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

## 思考与推理

- **Reasoning（推理/思考）**：模型在生成最终回答之前的内部思考过程，以文本形式暴露给用户
- **CoT（Chain of Thought，思维链）**：模型逐步推理的过程。在 UI 中以时间轴形式展示
- **Reasoning Offset**：工具调用在推理文本中的字符偏移位置，用于将工具调用和思考段落交错展示
- **Reasoning Text**：推理的文本内容，流式传输，播放 typewriter 动画

## 工具调用

- **Tool Event（工具事件）**：一次工具调用的完整生命周期记录，包含工具名、状态、参数、结果等
- **Tool Call Source**：工具来源 — builtin（内置）、plugin（插件）、MCP、workspace（工作区）、system
- **Tool Call Phase**：工具调用阶段 — arguments_streaming → pending_approval → executing → result/error/rejected/aborted
- **Tool Timeline（工具时间轴）**：将工具调用事件按 reasoning offset 与推理文本交错排列的垂直时间轴
- **Tool Node（工具节点）**：时间轴上的单个工具调用卡片
- **Tool Group（工具合并组）**：同一推理位置、同一类型的多个工具调用合并为一个摘要节点。展开后显示各子调用的明细。仅对 web_search 和 read_url 启用合并

## 搜索

- **Web Search（联网搜索）**：通过外部搜索引擎（tavily、brave、exa）检索网页
- **Read URL（网页读取）**：抓取并解析指定 URL 的正文内容
- **Auto Read（自动读取）**：搜索完成后自动触发网页读取，读取搜索结果中的网页。在 UI 中归入其所属的搜索节点内部
- **搜索批次**：同一 reasoning offset 下发起的搜索调用集合，用于合并展示
- **并行搜索**：多个搜索引擎同时查询，属于同一批次

## 密钥

- **Secret Vault（密钥库）**：由显式主密钥保护、加密保存用户或管理员私有凭据的系统边界；密钥值只允许写入和运行时使用，不允许回显、导出或跨能力继承

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
