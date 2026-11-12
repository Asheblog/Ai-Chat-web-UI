---
status: accepted
---

# MCP 运行层自实现协议客户端，本地包经容器网关运行

后端不引入 MCP 官方 SDK，自实现 JSON-RPC 客户端与三种传输（streamable HTTP、旧版 HTTP+SSE、stdio），并新增 `HttpMcpRuntimeClient` 作为 `McpRuntimeClient` 的实现注入 `McpService`。远程服务由后端直接建连；本地包型（stdio）不在宿主机启动进程，而是由 `docker run -i` 承载，容器限制 cap-drop、no-new-privileges、pids/cpus/memory，并由 `MCP_GATEWAY_*` 环境变量控制镜像与网络。

该决策兑现 ADR-0015 的沙箱要求，换来本地包能力可用；代价是网关依赖宿主机 docker，缺失时本地包只能登记为 `pending_gateway`，不得降级为宿主机执行。
