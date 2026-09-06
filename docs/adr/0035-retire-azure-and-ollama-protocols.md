---
status: accepted
---

# 移除 Azure OpenAI 与 Ollama 专属协议

供应商精简覆盖完整产品能力，不仅隐藏快速接入模板。删除 Azure OpenAI、Ollama 专属协议、微软 Entra 认证、专属推理参数和 Ollama embedding 引擎；仅保留 OpenAI Chat Completions、OpenAI Responses 与 Google Generative AI，以及 OpenAI 协议下的供应商配置，避免维护两套已停止提供的接入路径。

存量连接记录、凭据和历史对话保持关联。数据库迁移禁用旧协议连接并删除废弃的专属配置字段；管理与调用入口拒绝旧协议，不以 OpenAI 回退，不自动迁移密钥或模型身份。历史对话仍可阅读，继续使用相关服务需要重新创建受支持协议的连接。协议能力无兼容迁移、直接替换；数据库结构由新增 Prisma 迁移升级。
