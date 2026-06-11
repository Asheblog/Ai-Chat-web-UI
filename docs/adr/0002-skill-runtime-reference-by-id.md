---
status: accepted
---

# Skill 运行时引用使用稳定 ID

系统级 Skill 与不同用户的私有 Skill 可以拥有相同标识名，因此聊天和 Battle 请求中的 `skills.enabled` 直接替换为包含稳定 `skillId` 的结构化引用，不再接受 slug 字符串数组。slug 仅用于展示和搜索，服务端依据 `skillId` 校验可见性、所有权与会话绑定，以消除同名 Skill 的运行歧义；该协议无迁移兼容层，调用方需同步切换。
