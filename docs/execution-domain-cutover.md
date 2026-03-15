# Execution Domain 一次切换 SOP

本次改造采用“无兼容双轨、一次迁移、一次切换”。

## 1. 维护窗口前准备

1. 发布包含统一 SSE 协议的后端与前端版本（但先不开放流量）。
2. 确认 `@aichat/shared` 已构建并包含 `execution-contract` 导出。
3. 执行数据库结构变更（`ExecutionRun/Step/Artifact/Event` 四张表）。

## 2. 维护窗口执行顺序

1. 将应用切为只读或强限流（阻止新写入）。
2. 做数据库快照备份。
3. 执行一次性迁移：

```bash
pnpm --filter backend db:migrate:execution-domain
```

可选预演：

```bash
pnpm --filter backend db:migrate:execution-domain --dry-run
```

4. 部署新版本并重启服务。
5. 冒烟：
   - Chat `/chat/stream` 返回 `run_start/plan_ready/step_*/run_*/complete`
   - Battle `/battle/stream` 返回同一事件族
6. 全量放开流量。

## 3. 回滚预案

由于是一次性迁移，回滚必须整包执行：

1. 回滚应用版本到切换前版本。
2. 恢复切换前数据库快照。
3. 重新启动服务并验证旧链路。

## 4. 验收最小清单

1. Chat 与 Battle 流式事件无 `attempt_*` 事件输出。
2. 前端流解析统一基于 `step_* / run_*`。
3. 迁移脚本输出扫描量与迁移量一致（允许 dry-run 仅做统计）。
