# Task Trace 事件格式与保留规则

本文件是 task-trace 事件文件、`metadata.__trace` 与相关 HTTP 状态的对外格式说明。
实现见 `src/utils/task-trace.ts`（记录器）与 `src/services/task-trace/`（文件读取、导出）。

## 事件文件

- 路径：`${TASK_TRACE_LOG_DIR}/trace-<traceId>.log`。未设置时依次回退
  `${LOG_DIR}/task-trace`、镜像内 `/app/logs/task-trace`、宿主开发 `<cwd>/logs/task-trace`。
- 追加写入 NDJSON，一行一个事件：

```json
{"seq":1,"eventType":"request:init","payload":{...},"timestamp":"2026-11-16T02:48:50.000Z"}
```

- `seq` 单调递增，等于该记录的持久化条数；数据库 `TaskTrace.eventCount` 记录同一含义
  （**已写入文件的事件条数**，不含因预算丢弃的事件）。
- 文件最后一行固定是 `trace_finalized`，含 `status`、`durationMs`、`eventCount`、
  `omitted`、`overflow`。它不受任何预算约束，即使进程异常前只写了这一行也能定位真实终点。

## 事件分层与预算

| 分层 | 典型事件 | 默认预算 | 超限行为 |
| --- | --- | --- | --- |
| `noise` | `sse:dispatch`、`db:persist_progress` | `maxEvents`（默认 2000） | 丢弃并计数 |
| `normal` | `request:init`、`http:*`、`tool:event`（成功）、`skill:event` | 同噪声预算，可用 `TASK_TRACE_MAX_NORMAL_EVENTS` 覆盖 | 丢弃并计数 |
| `critical` | 任何带 `error`/`errorCode`/`status=error` 的事件、`stream:error`、`stream:cancelled`、`db:persist_final`、`trace_overflow`、`trace_finalized` | `max(1000, min(10000, 噪声预算))`，可用 `TASK_TRACE_MAX_CRITICAL_EVENTS` 覆盖 | 独立计数，不被噪声挤占 |

- 首次超限写入一条 `trace_overflow`：`{ tier: 'noise' | 'normal' | 'critical', limit }`，每层最多一条。
- 关键事件与噪声分开记账，所以「2000 条 SSE 分片之后工具错误与结束事件仍可查询」是结构保证，
  不是调大总上限的运气。
- 网页搜索编排将 `agent:provider_usage`（每次模型请求的用量）、`agent:first_visible_content`（首个可见正文分片的时刻）、`agent:answer_outcome`（最终答复交付结果）写到 `critical` 层。`agent:retrieval_chain_ended` 记录提前结束检索的原因，也归 `critical` 层。这些事件不保存正文；正文增量仍归 `noise`。关键预算若也耗尽，仍以关键层的丢弃计数为准。
- 网页检索的失败、超时、取消和部分成功也归 `critical`。摘要中的 `retrievalOutcome` 和 `searchEngines` 只保留有界状态字段；成功和无命中沿用普通预算。
- 单个事件负载仍按 `sanitizePayload` 截断（字符串 500、数组 10、对象条目 20、深度 3）。

## metadata.__trace

记录器在结束 metadata 里写一个保留键 `__trace`（其它键属于调用方，不会被改写）：

```json
{
  "__trace": {
    "eventCount": 2212,
    "omitted": { "noise": 150, "normal": 0, "critical": 2 },
    "overflow": { "noise": true, "normal": false, "critical": true },
    "metadataOmissions": [{ "path": "toolLogs", "kept": 100, "total": 500 }]
  }
}
```

- `eventCount`：实际写入文件的事件条数，与数据库 `eventCount` 一致。
- `omitted`：各分层因预算被丢弃的事件条数。存在非零值即代表**该记录不完整**，
  导出文件顶部会写出 `Omitted events: ...` 与中文说明。
- `overflow`：各分层是否已写过 `trace_overflow` 标记。
- `metadataOmissions`：结束 metadata 自身被截断的位置。结束 metadata 的数组上限是 100 项
  （旧实现是 10 项且不留痕），超出时逐条记录 `{ path, kept, total }`。
- 调用方预切片：数组同级出现数字键 `<key>Total` 时，记录器把裁剪前长度写进
  `metadataOmissions`。例如 chat 侧 `toolLogs` 只取前 50 条并声明 `toolLogsTotal: 82`，
  得到 `{ path: 'toolLogs', kept: 50, total: 82 }`；记录器自身截断与调用方声明同时存在时取
  较大值作为 `total`、取实际保留条数作为 `kept`。
- 旧记录没有 `__trace` 键：详情接口返回 `omissions: null`、`overflow: null`、
  `metadataOmissions: null`，三者一致表示**未知**，不表示没丢。记录有 `__trace` 但没裁过任何东西时
  `metadataOmissions` 是 `[]`，表示「确实没有省略」。

## 读取状态与 HTTP 状态

事件文件读取结果 `fileStatus`：`ok` | `partial` | `corrupt` | `missing` | `unreadable`，
详情接口另外返回 `pending`。

`pending` 是「记录器还没写第一条事件」的正常状态，不是文件丢失：记录器 `create()` 只存路径，
首次 flush（默认攒 20 条）才创建文件。判定条件同时满足才成立：

1. 读取结果为 `missing`；
2. 解析原因是 `missing`（即路径就落在当前配置目录里，只是文件还没出现）；
3. `trace.status === 'running'`；
4. `trace.eventCount === 0`。该数据库字段在任务结束时写入，running 期间通常为 0；检查它也为将来增量更新计数保留约束。

旧目录 / 文件名不匹配 / 无法定位一律保持明确的 409，不被 `pending` 掩盖。

| 情况 | 详情 `GET /api/task-trace/:id` | 导出 `GET /api/task-trace/:id/export` |
| --- | --- | --- |
| `ok` | 200，`fileStatus: 'ok'` | 200 文本，`File status: ok` |
| `partial`（部分行无法解析） | 200，`fileStatus: 'partial'` + `corruptLines` | 200 文本 + `Unparsed lines: N` + 中文警告 |
| `corrupt`（零可解析行） | 409 `TRACE_FILE_CORRUPT` | 409 同上（不返回附件） |
| `pending`（running 且尚未落盘） | 200，`fileStatus: 'pending'` + 空事件 | 409 `TRACE_NOT_READY`（不生成空附件） |
| `missing` | 409 `TRACE_FILE_MISSING` 或 `TRACE_FILE_EMPTY_PATH` | 409 同上 |
| `unreadable`（路径不是普通文件/读取失败） | 409 `TRACE_FILE_UNREADABLE` | 409 同上 |

错误体统一为 `{ success: false, error: '<中文原因>', data: { code } }`，
`error` 直接由现有后台 toast 展示。详情成功响应新增 `fileStatus`、`corruptLines`、
`omissions`、`overflow`、`metadataOmissions`；`truncated` 仍然只表示
「文件里还有事件没返回」的**展示截断**，与记录器的预算丢失是两件事。

## 旧路径迁移

读取已存库的 `logFilePath` 时只承认两类目录：当前配置目录，与已知 legacy 目录，
且文件名必须等于 `trace-<id>.log`：

- `/app/packages/backend/logs/task-trace`
- `<cwd>/logs/task-trace`（旧 backend 工作目录）
- `<cwd>/packages/backend/logs/task-trace`（从仓库根启动的宿主开发）
- `/app/logs/task-trace`
- `TASK_TRACE_LEGACY_LOG_DIRS`（逗号或分号分隔，运维显式追加）

命中 legacy 目录且当前目录存在同名文件时返回 `resolution: 'legacy-remap'`，导出头部写出
`Event file resolved via: legacy-remap`。

LaTeX 事件文件（`latex-trace-<taskTraceId>-<ts>.log`）用同一套目录策略，但文件名自带时间戳，
所以按**同名**文件映射，而不是按 id 推导名字；当前 latex 目录默认 `${LOG_DIR}/latex-trace`
（镜像内回退 `/app/logs/latex-trace`）。不满足目录或名字条件时返回明确原因
（`legacy-root-unknown` / `legacy-name-mismatch` / `legacy-target-missing`），
**不会退化成读另一个 trace 的文件**。
