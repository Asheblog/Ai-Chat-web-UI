# AIChat — 领域词汇表

## 消息与对话

- **Message（消息）**：对话中的一条发言，由 Meta（元数据）和 Body（内容体）组成
- **MessageMeta**：消息的元数据，不含内容。包含角色（user/assistant/compressedGroup）、推理状态、时间戳、token 速度
- **MessageBody**：消息的内容体，包含正文、推理文本、工具事件、生成图片、工作区附件等
- **Stable Key**：消息的稳定标识符，用于去重、持久化和缓存键

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
