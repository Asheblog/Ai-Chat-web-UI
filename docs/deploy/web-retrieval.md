# 小容器中的网页读取与日志迁移

升级镜像后，搜索优先复用提供方已经返回的正文；本地提取不足时才渲染页面。无需另起爬虫容器，也无需运行时安装包。

## 浏览器按需启动，并与 PDF 共用配额

默认同时只渲染一个页面，最多两个请求排队，完成后关闭各自 context，空闲 15 秒退出 Chromium。网页与 PDF 报告共享同一浏览器配额。网页渲染阶段最多 8 秒，并在活动期间检测内存压力；中止会释放该任务的 context 和配额。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| URL_READER_BROWSER_CONCURRENCY | 1 | 页面并发；小容器保留 1 |
| URL_READER_BROWSER_QUEUE_MAX | 2 | 等待队列长度；满时明确结束该次浏览器尝试 |
| URL_READER_BROWSER_IDLE_MS | 15000 | 浏览器空闲回收时间，毫秒 |
| URL_READER_BROWSER_MIN_HEADROOM_MB | 256 | 浏览器准入要求的可用内存余量，MiB |
| URL_READER_BROWSER_MIN_CONTAINER_LIMIT_MB | 768 | 浏览器准入要求的容器最小内存上限，MiB |

Linux 优先读取 cgroup v2 / v1 用量和限额；本机开发等无有效 cgroup 限额的环境使用可用内存信号。低于预算时跳过浏览器，保留已取得的正文、其他提取结果和具体尝试原因。

这些保护限制任务数量和存活时间；1Panel / Docker 的容器内存限额仍负责约束整个应用，包括聊天、数据库和 Worker。已有部署限额不由升级自动调整。

## Python 仅提取已下载 HTML

应用镜像内的专用 Python 环境包含锁定版本的 Trafilatura。它与管理员在设置页管理的 Skill Python 环境分离，不受 Skill 依赖整理影响。默认一个提取任务、两个等待请求、HTML 上限 1 MiB，空闲 15 秒退出。Node 读取流程为冷启动最多分配 4000 毫秒、已就绪任务最多 1500 毫秒；排队、启动和提取均计入同一预算，整体仍受单 URL 截止线约束。剩余预算不足以容纳冷启动时跳过该阶段。

镜像使用 /opt/python-extractor/bin/python，并在构建期间执行真实提取检查。宿主开发在仓库根建立独立 venv，安装同一份锁文件：

```sh
python -m venv .scratch/web-extractor-venv
.scratch/web-extractor-venv/bin/python -m pip install -r packages/backend/scripts/web-extractor/requirements.lock
.scratch/web-extractor-venv/bin/python packages/backend/scripts/web-extractor/smoke_test.py
```

Windows 将解释器路径中的 bin/python 替换为 Scripts/python.exe。用 APP_WEB_EXTRACTOR_PYTHON 指向该解释器；不要把应用依赖装入 Skill 的运行环境。若可选提取器不可用，能力状态会说明原因，已有 Node 正文提取和浏览器继续工作。

## 自动阅读的时限与证据种类

单 URL 超时仍约束该 URL；自动阅读批次另有总截止线，包含排队、全部 URL 和候选替补。默认争取两份证据，同时最多两个 URL；浏览器仍按单页面配额排队。批次默认 18000 毫秒，环境变量 WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS 或系统设置 web_search_auto_read_batch_timeout_ms 可调整，范围 3000–120000 毫秒；现有单 URL 超时设置含义保持一致。当前内容读取跳过普通正文缓存。同一任务内，`read_url` 可以复用搜索或自动阅读已取得且未截断的正文，并保留实际来源。核对原站或刷新时传 `fresh: true`；历史快照仅在 `purpose: "history"` 时使用。

工具详情保留每次实际尝试；恢复成功按最终正文结果结束。摘要、正文和结构化结果分别标记，不因切换来源而抹掉原 URL 的失败。正文质量检查会排除 JavaScript 提示、登录墙和纯链接导航；因此非空返回也可能被继续回退或判为无内容。HTTP 抓取收到 429 时解析 Retry-After，返回 HTTP_429 与可用的 retryAfterMs，本次停止请求该来源，不在截止线内等待重试。浏览器导航的响应状态暂未纳入这一元数据。

## 如何判断搜索是否正常交付

一次搜索可能有结果、部分成功、无命中、全失败、超时或取消，见父工具事件的 `retrievalOutcome`。部分成功仍可使用有效证据；诊断持续失败时先看各引擎的错误类别、状态码和冷却状态。退避只影响当前进程中的对应引擎连接，重启不保留冷却。 纯检索连续两轮全失败或超时，或已明确没有可用引擎时，结束重复检索。已有证据最多再请求一轮不带工具的答复；没有证据则直接结束。提前结束的具体原因见 `agent:retrieval_chain_ended`，与用户停止工具和全局轮数上限分开。

普通文字任务继续收到候选图片链接，需要视觉证据时传 `include_images: true`；直接读取图片资源不受此开关影响。点名来源时用 `domains` 收窄范围，不放宽部署白名单。近期搜索用 `time_range.start` 和 `time_range.end`（`YYYY-MM-DD`）；日期未知的结果不能当作已确认在时间窗内的证据。新闻答复逐条附来源链接和日期，区分机构估算与正式公告。

排查耗时时，从追踪的 `agent:first_visible_content` 看首答等待，从 `agent:provider_usage` 看逐轮用量，从 `agent:answer_outcome` 看是否真正交付。`completed` 仍表示流流程完成，不等同于答复交付。追踪的跨轮用量不改变计费口径。`toolWallTimeMs` 只计注册工具执行区间的并集；总时长减去该值后，剩余还包括流传输、编排和持久化等等待。

## 重建前保留旧追踪文件

新的标准日志目录为 /app/logs/task-trace，位于持久化日志卷。首次更新前，若现存容器层仍有 /app/packages/backend/logs/task-trace，应先备份并复制其中事件文件，再重建容器。

以下操作仅复制现存文件，不删除旧目录或修改数据库：

```sh
docker compose exec app sh -c 'for trace_dir in task-trace latex-trace; do mkdir -p /app/logs/$trace_dir; if [ -d /app/packages/backend/logs/$trace_dir ]; then cp -an /app/packages/backend/logs/$trace_dir/. /app/logs/$trace_dir/; fi; done'
```

如部署使用其他容器名或目录，按当前编排替换 app 与路径。先备份数据库和日志卷，再执行日常镜像更新；保留数据卷。

已结束任务的事件文件缺失、路径为空、不可读或完全损坏时返回明确错误，详情不再呈现为正常空记录，导出也不会生成成功的小文件。任务进行中且尚未首次刷盘时，详情标记 pending，导出提示稍后再试。部分损坏的文件保留可读内容并说明损坏状态；写入时丢弃与界面展示截断分别记录。已经丢失的文件需从旧容器或备份恢复。

## 验收依据

使用固定 HTML 回归正常文章、真实验证页、缺 MIME、结构化列表、正文来源与摘要区别，并验证队列满、取消、超时、低内存、崩溃和空闲退出。实际浏览器检查确认复用进程和隔离 context。实时站点结果受来源响应影响，应连同结果日期、环境、超时与错误一起评估，不以摘要或存档充当当前正文。
