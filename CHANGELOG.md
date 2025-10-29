# 更新日志

## v1.3.5 · 2025-10-29

- 新增聊天图片本地化存储：后端将图片写入 `storage/chat-images` 并通过 `message_attachments` 表持久化路径，前端展示会优先使用服务端返回的可访问 URL，刷新或跨端均可查看历史图片。
- 系统设置新增“图片访问域名”配置并提供管理员刷新接口，可自定义生成外部访问地址；若留空将自动回退到请求头或局域网地址，便于本地调试。
- 系统设置新增“聊天图片保留天数”项（默认 30 天，可设为 0 立即清理），同时在新消息入库时后台会按设定异步清理过期附件。
- 聊天输入框在点击发送后即清空已选图片，发送失败会自动回滚，避免重复点按造成的残留。
- 部署须执行数据库迁移：`pnpm --filter backend prisma migrate deploy`（或等效的 `prisma migrate deploy` 流程），确保 `message_attachments` 表创建完毕后，再运行 pnpm --filter backend prisma generate 重新生成 Prisma Client，再重启服务。

## v1.3.4 · 2025-10-29

- [7e5f232](https://github.com/your-username/aichat/commit/7e5f23226c05d0242d7cb20671e76b5190a01e1f) 调整聊天输入区布局、按钮悬停态与移动端安全区内边距，统一多端视觉体验。
- [7bb98a3](https://github.com/your-username/aichat/commit/7bb98a3f49d4c9a4e87034158293dfcf47ada8e8) 侧边栏改用语义化颜色令牌，确保亮暗主题下的层级与可读性一致。
- [805d132](https://github.com/your-username/aichat/commit/805d13272f80d09d0313840981cfb0d04ae99ae2) 将静态图片全面替换为Next.js `Image`，补足中文alt文本并收敛多处依赖数组，减少无效渲染。
- [e61d494](https://github.com/your-username/aichat/commit/e61d4945080ff506470caa6ca9df7df29fa01f92) 登录/注册页面抽离复用的`AuthFormLayout`，移除冗余Shell组件，降低表单布局重复代码。
