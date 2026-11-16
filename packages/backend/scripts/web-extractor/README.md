# Web extractor worker（Trafilatura）

已下载 HTML 的正文提取 worker。Node 侧适配器：`packages/backend/src/utils/web-retrieval/python-extractor.ts`。
worker 只解析传入的 HTML，不发任何网络请求；网络、截止线、取消和浏览器都在 Node 侧。

## 协议（JSON Lines）

stdin 每行一个任务：

```json
{"id":"wx-1","url":"https://example.com/a","html":"<!DOCTYPE html>..."}
```

stdout 每行一个事件，只有下面几种：

```json
{"type":"ready","trafilatura":"2.3.1"}
{"id":"wx-1","ok":true,"document":{"title":"...","content":"...","excerpt":"..."}}
{"id":"wx-1","ok":true,"document":null}
{"id":"wx-1","ok":false,"error":{"code":"EXTRACT_FAILED","message":"..."}}
```

- `document` 为 `null` 表示没提取到正文。
- 诊断信息只走 stderr，stdout 只放协议行。
- stdin EOF 即正常退出（Node 侧空闲退出依赖这一点）。
- 依赖导入失败时在打印 ready 之前退出，退出码 3。

提取策略：先用 Trafilatura 精确模式，正文短于 500 字符时用 `favor_recall=True` 重试一次，取更长的结果；
正文最多 200k 字符。

输入上限分两层，实际生效的是 Node 侧：适配器拒绝超过 **1 MiB** 的 HTML（直接返回 null，不截断后提取，
不启动进程）。worker 里的 4 MiB 只是协议层兜底，防止调用方绕过适配器时把内存打满，不是部署可接受的大小。

## 依赖

`requirements.txt` 是直接依赖，`requirements.lock` 是 `pip freeze` 的全量锁定（含传递依赖），
镜像与本地都装 lock。`lxml-html-clean` 不能省：lxml 5 之后 `lxml.html.clean` 独立成包，
缺它 worker 会在导入阶段退出 3。

重新锁定（在隔离 venv 内，别动 Skill 运行时）：

```bash
python -m venv .scratch/web-extractor-venv
.scratch/web-extractor-venv/bin/python -m pip install -r requirements.txt
.scratch/web-extractor-venv/bin/python -m pip freeze > requirements.lock
```

## 部署

- 镜像：`packages/backend/Dockerfile` 的 base 阶段建 `/opt/python-extractor` venv，
  production 阶段复用该目录，并在构建时跑 `smoke_test.py` 校验真实可用。
  all-in-one 镜像（`docker/Dockerfile`）基于 backend 镜像，自动继承。
- 解释器定位顺序（`resolvePythonInterpreter`）：`pythonPath` 显式配置 →
  `APP_WEB_EXTRACTOR_PYTHON` → `/opt/python-extractor/bin/python` →
  `$APP_DATA_DIR/python-extractor/venv/{bin/python|Scripts/python.exe}` → PATH 上的 `python3`/`python`。
- worker 脚本定位：`scriptPath` 显式配置 → `APP_WEB_EXTRACTOR_SCRIPT` →
  从当前工作目录向上查找 `scripts/web-extractor/extract_worker.py` 与
  `packages/backend/scripts/web-extractor/extract_worker.py`。
- Windows 宿主开发：建一个自己的 venv 装上 `requirements.lock`（与镜像同一份全量锁定，别只装
  `requirements.txt`，否则传递依赖版本可能与镜像不一致），再把 `APP_WEB_EXTRACTOR_PYTHON` 指向该 venv 的
  `python.exe`；代码里没有写死平台路径。

## 校验

```bash
<python> smoke_test.py
```

smoke 用固定中文样例走完整 JSONL 往返，断言：握手版本、正文含标记段落、导航文本不混入、标题与摘要都有。
镜像构建失败比线上静默降级更早暴露问题，所以这一步放在 Dockerfile 里。

## 资源约束

- 单实例 1 个在途任务，队列上限 2 个；队列满直接返回 `null`，不让调用方排长队。
- 单任务时限（默认 1500 ms）从**排队时刻**开始计，排队等待不会被算成额外预算。
- **冷启动也在同一份预算里**：新进程要先启动 Python 再 import Trafilatura（本机实测 spawn→ready 0.46–0.68 s，
  首个文档再 +0.23–0.35 s；warm 任务约 20 ms），低配主机按比例放大。所以 worker 未就绪时调用方应给更宽的单次
  `timeoutMs`（可用 `describeState().workerReady` 判断冷/热），而不是指望框架豁免冷启动。
  进程就绪后 5 s 仍未打印 ready 会被拆除，这条是卡死兜底，不是冷启动预算。
- 超时、取消、进程崩溃都会立即 SIGKILL 自己拥有的进程并结算在途任务；等旧进程 exit 后才重建，避免两个进程并存。
- 空闲 15 秒后 stdin EOF 退出，容器里不留常驻空转进程。
- 配置级缺失（没有解释器/脚本）在本进程内不再尝试；可恢复故障（启动失败、崩溃）进入 30 秒冷却后自动重试。
