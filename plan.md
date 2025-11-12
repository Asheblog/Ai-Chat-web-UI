# 全程日志与后台追踪改造落地计划

## 阶段 1：数据结构与系统设置扩展
1. **Prisma 新表**
   - `task_traces`：记录 sessionId、messageId、clientMessageId、actor、status、traceLevel、metadata、startedAt、endedAt、durationMs。
   - `task_trace_events`：记录 traceId、seq、eventType、payload(JSON)、timestamp。
2. **系统设置字段**
   - `task_trace_enabled`（总开关）、`task_trace_default_on`、`task_trace_admin_only`、`task_trace_env`(`dev|prod|both`)、`task_trace_retention_days`、`task_trace_max_events`（单条追踪最大事件数）、`task_trace_idle_timeout_ms`（心跳超时告警阈值）。
3. **Settings API**
   - `GET /api/settings/system` 返回上述字段。
   - `PUT /api/settings/system` 可写入/更新字段，带基础校验。
4. **迁移脚本**
   - 更新 Prisma schema、生成 migration。
   - 文档说明如何运行 `prisma migrate deploy`。

## 阶段 2：后端 Task Trace 服务
1. **utility**
   - `TaskTraceRecorder`：负责 `create/log/finalize`，内部批量落库。
   - `shouldEnableTaskTrace`：根据系统设置、环境、管理员身份、请求参数决定是否记录。
2. **/api/chat/stream 集成**
   - 解析前端传入 `traceEnabled`。
   - 在关键节点写事件：请求参数、SSE chunk、keepalive、tool event、persist progress、usage 统计、错误/取消、完成；支持 keepalive timeout/abort/retry 等异常事件。
   - 在异常/取消/完成时调用 `finalize`。
   - 若启用 agent web-search，同样注入 trace，记录工具调用及最终结果。
3. **Task Trace API（管理员）**
   - `GET /api/task-trace`: 分页列表，支持 session、状态、关键字过滤。
   - `GET /api/task-trace/:id`: 返回基本信息 + 事件分页/增量加载（默认 2000，可按需加载更多）。
   - `GET /api/task-trace/:id/export`: 导出 TXT（trace 元信息 + 时间线）。
4. **保留/清理**
   - 后台提供按保留期自动清理脚本或管理按钮（调用新 API）。

## 阶段 3：前端 UI 与交互
1. **系统设置面板**
   - 新增「日志与监控」卡片：全局开关、默认值、可视环境、保留天数、最大事件数、心跳超时、当前占用、手动清理按钮。
   - 仅管理员可访问。
2. **日志查看器**
   - 列表：时间、会话、状态、事件数、开关来源；支持管理员筛选/搜索。
   - 详情抽屉：事件 timeline（分页/加载更多，可折叠 payload JSON）；导出按钮调用 `/export` 并附关键事件摘要。
3. **输入框侧开关**
   - 仅管理员可见；默认值取系统设置，可记忆会话级别。
   - 勾选后发送消息时附加 `traceEnabled: true`。
   - 添加提示文案：“记录完整任务日志（可能影响性能）”。
4. **会话详情入口（可选）**
   - 在消息更多操作或系统设置列表中提供“查看日志”跳转。

## 阶段 4：验证与部署
1. **本地/开发环境**
   - 开启 task trace，全流程跑长 COT，确认日志完整，导出内容正确。
   - 覆盖：刷新页面、断网、点击停止、Agent 搜索、Quota 429、模型异常等场景。
2. **生产灰度**
   - 默认仅管理员可启用；在系统设置中按需开启。
   - 观察数据库体量与写入 QPS，必要时调整 `payload_max_length` 或批量间隔。
3. **文档与监控**
   - README 或 docs 说明如何配置开启、如何查看日志、清理策略。
   - 可在日志记录中加入 `traceId` 并输出异常摘要，方便与现有日志/告警关联。

---

> 以上计划按阶段推进，推荐顺序：阶段 1 → 2 → 3 → 4。实施过程中若需细化任务或拆分 PR，可以此为参考。***
