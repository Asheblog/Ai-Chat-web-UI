# 合并 OpenAI 交错思考为 Completions 能力

**状态：** 已确认（grilling：Q1a / Q2a / Q3b）  
**日期：** 2026-09-07

## 目标

删除「OpenAI（交错思考）」独立模板卡。协议模板收敛为 OpenAI Chat Completions / OpenAI Responses / Google。Thinking 方言变为 Completions 连接组能力 `thinkingDialect`。

## 决策

| 项 | 选择 |
|---|---|
| UI 模板 | 3 卡；无第四协议卡，无独立 DeepSeek 预设入口 |
| 存量 | `vendor ∈ {openai_interleave, deepseek}` → `thinkingDialect=deepseek_compat`，清空 `vendor` |
| 新建默认 | baseUrl 启发（deepseek / siliconflow 等）→ `deepseek_compat`，否则 `off`；可手动改 |

## 领域模型

- **Thinking Dialect（思考方言）**：Completions 连接组上是否向请求体注入厂商 `thinking` 控制参数。取值：`off` | `deepseek_compat`。
- **Supported Provider Protocol**：仅 OpenAI Chat Completions、OpenAI Responses、Google Generative AI。不再把「交错思考」表述为独立供应商配置面。
- **vendor 字段**：退役；迁移后恒为 null；API 不再接受写入；导入忽略旧 vendor，按 `thinkingDialect` + 端点签名合并。

## 运行时

- `thinkingDialect === deepseek_compat` 时：注入 `thinking: { type: enabled|disabled }`（与现 vendor 行为一致）。
- 工具环 `reasoning_content` 回传保持现有全开逻辑，不按方言门控。
- Responses / Google 路径不读写该字段。

## 明确不做

- 不并入 Responses
- 不对所有 OpenAI 连接默认发 `thinking`
- 不重做 CoT UI

## 迁移说明

破坏性：导入签名从含 `vendor` 改为含 `thinkingDialect`；旧导出包中的 vendor 仅用于推断 dialect，不再作为身份分量。无协议回退层。
