---
status: accepted
---

# Secret Vault 必须配置显式主密钥

Secret Vault 不提供静默默认主密钥；普通运行和生产运行在缺少主密钥时 fail closed，并通过 setup/status、日志和部署文档给出明确修复指引。该决策要求同步更新 yml、README 和启动模板，牺牲无配置启动便利性，换取密钥加密边界不依赖共享默认值。
