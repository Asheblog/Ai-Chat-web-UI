---
status: accepted
---

# OpenAI Completions 以 Thinking Dialect 表达思考参数注入

OpenAI Chat Completions 连接不再用独立「交错思考」模板卡或 `vendor`（`deepseek` / `openai_interleave`）表达是否注入厂商 `thinking` 参数。协议模板收敛为 OpenAI Completions / OpenAI Responses / Google；Completions 连接组新增能力字段 `thinkingDialect`（`off` | `deepseek_compat`）。

存量 `vendor ∈ {deepseek, openai_interleave}` 迁移为 `thinkingDialect=deepseek_compat` 并清空 `vendor`。新建连接可按 baseUrl host（含 deepseek / siliconflow）启发默认方言，用户仍可在 OpenAI 编辑器中覆盖。运行时仅在 `deepseek_compat` 时注入 `thinking: { type: enabled|disabled }`；工具环 `reasoning_content` 回传逻辑保持既有全开行为，不按方言门控。导入签名以 `thinkingDialect` 替代 `vendor`；旧导出包中的 vendor 仅用于一次推断。无协议回退层，直接替换。
