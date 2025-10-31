# 更新日志

## v1.3.5 · 2025-10-31

- BREAKING: 移除个人连接功能，所有模型连接统一由系统管理员维护。升级后请在「系统设置 → 模型管理」中重新录入所需连接，旧个人连接即使保留在库中也不会再加载。
- 新增匿名访客模式：后端为未登录访客分配匿名会话与 Cookie，支持自定义保留天数（0-15 天）并在新消息写入时自动清理过期匿名会话与附件。
- 引入调用额度体系：系统设置可分别配置匿名访客与注册用户的每日额度，后端通过 `usage_quota` 表追踪用量并在超额时阻止请求。
- 聊天消息支持图片上传，本地保存在 `storage/chat-images` 并通过 `message_attachments` 表持久化；系统设置新增图片访问域名与保留天数选项，前端发送失败会自动回滚已选图片。
- 模型目录改为数据库缓存，新增后台自动刷新、连接变更触发与管理员手动刷新能力，降低外部 API 请求频率。
- API 与前端增强：聊天/开放兼容接口增加全链路流量日志；前端 API 客户端新增 `suppressAuthRedirect` 选项；主页取消强制登录跳转，未登录访问时仍可加载页面。
- 升级指引：运行 `pnpm --filter backend prisma migrate deploy` 应用数据库迁移（含 `message_attachments`、`usage_quota`），随后执行 `pnpm --filter backend prisma generate` 并重启服务；若需启用匿名访客，请在系统设置中开启注册及相关配额。

## v1.3.4 · 2025-10-29

- [7e5f232](https://github.com/your-username/aichat/commit/7e5f23226c05d0242d7cb20671e76b5190a01e1f) 调整聊天输入区布局、按钮悬停态与移动端安全区内边距，统一多端视觉体验。
- [7bb98a3](https://github.com/your-username/aichat/commit/7bb98a3f49d4c9a4e87034158293dfcf47ada8e8) 侧边栏改用语义化颜色令牌，确保亮暗主题下的层级与可读性一致。
- [805d132](https://github.com/your-username/aichat/commit/805d13272f80d09d0313840981cfb0d04ae99ae2) 将静态图片全面替换为Next.js `Image`，补足中文alt文本并收敛多处依赖数组，减少无效渲染。
- [e61d494](https://github.com/your-username/aichat/commit/e61d4945080ff506470caa6ca9df7df29fa01f92) 登录/注册页面抽离复用的`AuthFormLayout`，移除冗余Shell组件，降低表单布局重复代码。
