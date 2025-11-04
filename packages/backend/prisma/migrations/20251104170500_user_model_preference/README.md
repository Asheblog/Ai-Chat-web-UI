# Migration: user model preference

- 向 `users` 表新增三个字段：`preferredModelId`、`preferredConnectionId`、`preferredModelRawId`
- 用于持久化登录用户的默认模型选择
