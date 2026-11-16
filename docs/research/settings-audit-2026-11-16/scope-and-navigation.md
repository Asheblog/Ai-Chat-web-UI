# 设置审计范围与入口判断

审计基线：本地 `main`，提交 `bb376960`；日期：2026-11-16。本文件是基线记录，最终采纳与实施见 [设置精简实施与升级](implementation.md)。

本文件记录完整性基准和不属于各分项字段表的入口判断。默认值指代码默认；配置实际值未读取。

## 范围

- 系统注册树共 10 个叶子页：概览、供应商与连接、模型管理、搜索与知识库、能力扩展、用户与注册、品牌与界面、日志与审计、数据与维护、推理与网络。证据：[注册树](../../../packages/frontend/src/components/settings/system-settings-registry.tsx#L107)。
- 个人设置弹窗有偏好、Skills、分享、安全、关于；独立个人页面有资料与偏好、Skills、分享、安全。证据：[弹窗导航](../../../packages/frontend/src/components/settings/nav.tsx#L43)、[独立页导航](../../../packages/frontend/src/app/main/settings/_components/settings-layout-client.tsx#L55)。
- 覆盖页面内的连接编辑、模型能力覆写、RAG、MCP、Skill、Python 运行时等弹窗；不把筛选、分页、测试连接、导入导出、安装/卸载、撤销分享计入系统配置字段。
- 共享契约有 **111 个映射字段**，另有 `assistantAvatarRemove` 操作；它们是覆盖基准，不等同 111 个可调控件。`assistantAvatarUrl`、`webSearchHasApiKey*` 是只读派生状态，上传是操作。证据：[共享契约](../../../packages/shared/src/settings-contract.ts#L2)、[共享类型](../../../packages/shared/src/settings-codec.ts#L15)。完整机器清单见 [field-inventory.json](field-inventory.json)。
- 移动端独立配置只有服务端地址，连接 AIChat 自托管后端并检测健康状态。**保留**；它与供应商 API 地址属于不同层级。证据：[地址页](../../../packages/mobile/src/screens/EndpointScreen.tsx#L75)、[规范化和健康检测](../../../packages/mobile/src/server-endpoint.ts#L20)。

## 概览的完成条件应重写

| 当前判断 | 问题 | 建议 |
| --- | --- | --- |
| 连接列表非空 → 模型接入完成 | 存在配置不代表连接有效 | 展示连接状态和最近检测结果；用户按需测试，不把每次进入设置变成探测 |
| 开放注册 → 已完成 | 关闭注册可能是有意的私有部署 | 改为可选访问策略，不计为未完成 |
| 开启搜索 → 已完成 | 不需要联网的部署也完整可用 | 改为可选能力状态 |
| 模型列表非空 → 默认模型完成 | 列表存在与默认选择不是同一含义 | 展示确实可用的模型；若没有系统默认模型契约，删除“默认模型”完成项 |

证据：[概览判断](../../../packages/frontend/src/components/settings/system-settings-registry-overview.tsx#L67)、[完成提示](../../../packages/frontend/src/components/settings/system-settings-registry-overview.tsx#L143)。

## 日志是管理入口

`/main/logs` 已将运行日志和任务追踪组合到同一入口；另有独立路由。系统设置中的日志级别、保留策略与日志查看操作分开：前者是配置，后者是管理能力。精简设置时保留现有路由可达性，减少导航重复。证据：[日志页](../../../packages/frontend/src/components/settings/pages/LogViewerPage.tsx#L9)、[日志路由](../../../packages/frontend/src/app/main/logs/page.tsx#L1)。

## 回答版本保留会改变用量统计

基线代码中，[版本清理](../../../packages/backend/src/modules/chat/assistant-message-service.ts#L175)（行号指基线提交）在超过上限时同时删除旧消息与其 `usageMetric`（第 194–196 行，实施后该分支已移除）；[会话总用量](../../../packages/backend/src/modules/chat/routes/usage.ts#L42)、[会话列表用量](../../../packages/backend/src/modules/chat/routes/usage.ts#L133)、[每日用量](../../../packages/backend/src/modules/chat/routes/usage.ts#L211) 都直接聚合仍存在的记录。由此可推得：超限清理会降低这些页面/API 的累计数字，已付出的调用消耗仍然发生。

基线建议是把回答正文的保留规则与消耗记录分离，并明确统计代表真实发生的调用消耗还是剩余消息的消耗（推荐前者）。

**最终决定（已实施）：取消回答版本上限。** 用户明确要求回答版本全部保留，因此删除设置入口、共享契约字段与 `ensureVariantWindow` 的删除分支；所有版本与其 `usageMetric` 一起保留，累计用量代表真实发生的调用消耗，`variantIndex` 只做重排以维持版本选择与重新生成。**不需要新增“手动删除某个版本”的功能**——诉求是保留全部版本，而不是换一种删除方式。迁移删除存量 `assistant_reply_history_limit` 行，升级不清空聊天数据（[implementation.md](implementation.md)）。上文前两段是基线观察，保留作证据。

## 评估边界

本页是基线评估：审计当时产品行为未变更。采纳与实施结果见 [implementation.md](implementation.md)；领域决策与 ADR 是否更新由实施侧统一处理。模型官方事实与产品建议分别标明。
