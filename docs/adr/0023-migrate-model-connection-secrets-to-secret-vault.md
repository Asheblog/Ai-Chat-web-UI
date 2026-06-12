---
status: accepted
---

# 模型连接密钥迁移到 Secret Vault

Secret Vault 作为 MCP 前置基础设施时，同步承接现有模型连接 API Key，模型连接只保存密钥引用并移除默认加密 key 回退。该决策扩大迁移范围并要求部署方配置真实主密钥，换取 MCP、Skill 和模型连接使用同一套密钥边界，避免新旧两套密钥存储长期并存。
