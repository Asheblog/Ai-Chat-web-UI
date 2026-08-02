---
status: accepted
---

# SecretVault / ChatRequestBuilder 单例收敛至 AppContainer

`SecretVaultService` 与 `ChatRequestBuilder` 此前在 `index.ts`、`container/app-container.ts`、`services/connections/index.ts` 三处各自构造，导致同一进程出现多个 vault 实例（master-key 校验与加密上下文分叉）与两个 requestBuilder（battle 与 chat 行为可能不一致）。

因此约定：`AppContainer` 持有全进程唯一的 `secretVault` 与 `chatRequestBuilder`，`index.ts` 从容器取值；`services/connections/index.ts` 移除顶层急切构造副作用，改为纯再导出。`BattleExecutor` 仍保留 `deps.requestBuilder ?? new ChatRequestBuilder()` 兜底以支持测试与独立使用（非主链路）。`ServiceRegistry` 保留（`document-services-factory` 依赖其存储 documentServices 快照），不删除。
