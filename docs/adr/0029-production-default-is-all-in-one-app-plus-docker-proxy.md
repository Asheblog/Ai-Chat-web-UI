---
status: accepted
---

# 生产默认拓扑为 all-in-one app + docker-proxy

单机/1Panel 部署升级时，用户主要痛点是多容器多镜像版本对齐。因此生产默认改为一个应用镜像（`ghcr.io/<owner>/aichat`）同时运行 frontend、backend、rag-worker，并单独保留 `tecnativa/docker-socket-proxy`，避免把 Docker socket 直接挂进业务容器。旧四容器拓扑保留为 `docker-compose.split.yml`，供需要拆分扩展的场景使用。
