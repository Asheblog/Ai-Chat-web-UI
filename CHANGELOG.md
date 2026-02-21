# 更新日志

## 未发布

- BREAKING: 系统设置导航从 13 个子页收敛为单一「配置中心」入口，模块改为页内二级分组切换（基础运行、模型与工具、知识与文档、治理与审计）；迁移策略为无迁移、直接替换。

## v1.9.0 · 2026-02-19

- BREAKING: 移除 URL Reader 开关配置（`enableUrlReader` 等），聊天与工具调用统一按新编排链路执行；迁移策略为无迁移、直接替换。
- Battle 对战支持“题目图片 + 期望答案图片”全链路能力：后端入库与执行器、前端流程与分享页、共享契约同步升级（含未推送提交 `453ec7c`）。
- Tool Orchestrator 重构为独立模块，并增强最大迭代控制：`maxIterations <= 0` 视为无限迭代，达到上限时抛出明确错误，Chat/Battle 行为保持一致。
- 错误处理增强：工具编排异常与 API 错误解析器补充结构化处理路径，并新增对应测试用例。
- 运行环境更新：后端 Docker 镜像增加 PuLP 线性规划依赖。
- 升级指引：执行 `pnpm --filter backend prisma migrate deploy` 应用 `20260218110000_add_battle_run_images`（新增 `battle_runs.promptImagesJson` 与 `battle_runs.expectedAnswerImagesJson`），随后执行 `pnpm --filter backend prisma generate`；Docker 部署请重建后端镜像。

## v1.3.8 · 2025-11-05

- 注册审批系统：移除环境变量 `APP_MODE`，改用 `DEFAULT_REGISTRATION_ENABLED` 控制注册开关；后端新增待审批/禁用状态与审批接口，首位注册用户自动成为管理员，其余用户需经审批；前端注册流程与用户管理页同步支持新的审批状态。
- 设置中心重构：重织设置导航、卡片布局与徽标标签，统一间距与图标语义，改进动画与响应式体验，整合系统/个人设置分组以提升可用性。
- 推理展开控制：为消息气泡引入系统级「默认展开推理」开关，支持在后台将 OpenAI Reasoning Effort 设置为 `unset` 以清除覆盖值；推理渲染会随配置更新保持同步。
- 欢迎页品牌文案：欢迎页页脚免责声明支持自定义品牌名称，当未配置时回退为 `AIChat`。
- 升级指引：执行 `pnpm --filter backend prisma migrate deploy` 应用用户审批相关迁移，并运行 `pnpm --filter backend prisma generate` 更新客户端。

## v1.3.7 · 2025-11-04

- 用户模型偏好持久化：新增数据库字段与API，同步匿名与登录会话的模型选择，并在前端默认选择器中自动记忆个人偏好。
- 弹窗无障碍增强：聊天界面、设置面板与欢迎页弹窗补充隐藏标题，为屏幕阅读器提供准确的语义提示。
- Markdown 处理稳健性：worker 渲染失败时返回空结果并在开发环境发出警告，避免未捕获拒绝导致界面异常。
- 数据库迁移：执行 `pnpm --filter backend prisma migrate deploy` 同步 schema，随后运行 `pnpm --filter backend prisma generate` 更新客户端。

## v1.3.6 · 2025-11-04

- 引入动态上下文窗口：后端根据模型目录 `metaJson` 元数据、Ollama API 响应与内置映射动态解析上下文长度，前端新增开关允许禁用上下文扩展；移除环境变量 `DEFAULT_CONTEXT_TOKEN_LIMIT`，请确保所有模型配置具备正确的上下文信息。
- 上下文与调用管控增强：聊天接口与统计模块会记录实时上下文使用情况，系统设置支持缓存上下文限制并校验 OpenAI Base URL，防止配置错误。
- Markdown 渲染性能优化：前端拆分消息元数据与渲染缓存，引入 worker 管道统一 Markdown 处理，新增虚拟滚动以提升长会话渲染性能，并优化代码块样式与推理内容展示。
- 依赖与类型更新：为虚拟滚动与 Markdown 渲染补充必要依赖，调整聊天存储结构与组件以适配渐进式渲染路径。

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
