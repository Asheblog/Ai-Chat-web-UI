---
status: accepted
---

# Workspace Docker 全局并发配额与孤儿容器清理

单机小规格部署上，聊天/Battle/Skill 可同时起多个 `python:3.11-slim` 容器；仅有单容器 cgroup 上限、没有全局并发闸门时，瞬时 CPU/内存会打满宿主。更隐蔽的是：执行超时只杀掉 `docker` CLI 子进程，容器本身继续占用资源，多次超时后累积为孤儿容器。

因此约定：所有 `DockerExecutor.run` 共用进程内 FIFO 槽位（默认 2，排队超时 15s）；每个 run 使用稳定容器名 `aichat-ws-<uuid>`，超时/取消时主动 `docker kill` + `docker rm -f`；后端启动时按此前缀兜底清理。超额排队而非 429，以便短任务自然串行。Battle 模型流并发保持不变——真正护栏是 Docker 槽位，而非降低 LLM 并发。
