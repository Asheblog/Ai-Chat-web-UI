# 前端性能修复验收记录

- 日期：2026-11-06。
- 实施分支：codex/frontend-performance。
- 固定审查基线：fdc022215df8ad4575cc0cf91090a1ba3649edc7。
- 迁移：无迁移，直接替换前端实现；沿用现有会话、消息、API 与四个个人设置 hash。
- 用户已批准计划、分工实施、合并 main 与推送。

## 修改范围

1. Markdown Worker 纯 JavaScript 依赖入口、ready 握手、任务截止时间、失败冷却和有界恢复；移除大文本主线程整篇解析。
2. 消息行订阅、流式视口与输入隔离、快照缓存来源校验；分享与 Battle 保留只读路径。
3. 阅读导航、滚动持久化与虚拟测量按帧合并；textarea 离屏测量；CoT 折叠窗口和稳定代码块。
4. 非敏感首屏骨架、管理员向导和设置叶子按需加载；已知会话并行请求，保留权限与竞态检查。
5. 品牌 fetch/响应体共用 1.5 秒 deadline，TitleSync 有限重试与恢复；生产保留 warn/error；日期缓存有界并保留时区与阈值语义。

## 测试与审查

- pnpm --filter @aichat/frontend exec vitest run --reporter=dot：105 文件、583 测试通过。随后分享面板新增的实际 render-count 断言定向 2/2 通过。
- pnpm --filter @aichat/frontend type-check：通过。
- pnpm --filter @aichat/frontend build：生产编译、静态生成、trace 与产物复制通过；主聊天 First Load JS 658 kB → 324 kB。
- Standards 与 Spec 双轴独立审查完成；Worker 同快照恢复、日期阈值、虚拟测量、TitleSync 恢复接线、分享订阅和两处 TS2554 均已处理。
- 既有警告：Zustand equality API deprecated、测试中的 React act/Radix 提示；不将通过描述为零警告。
- 新增真实浏览器验收发现移动/桌面输入框共用 ref 导致手机多行内容不增高。旧三行夹具未超过手机 min-height=64px，不能证明自动增高；强化为九行中文粘贴后稳定复现。修复使共享 ref 只归当前 md(768px) 断点的可见 composer，使用两侧独立 owned ref 防止旧节点解绑清空共享引用，并在目标切换时重测。
- 移动修复后相关 20 文件、97 测试通过，覆盖九行中文测量 180px、隐藏输入框不测量与 390↔1440 往返；独立 type-check 再次通过；Standards 增量复核无阻塞。断点切换不自动迁移焦点，现有会话切换/流结束聚焦行为继续保留。

## 生产浏览器回归

命令：node packages/frontend/scripts/performance-smoke.mjs。使用本机生产 next start、Chromium、合成 API 和真实打包 Worker，所有截图及 JSON 写入 ignored 的 output/playwright/frontend-performance/。

脚本支持 PERF_BASE_URL、PERF_OUTPUT、PERF_BASELINE、PERF_FIXTURE_PORT、PLAYWRIGHT_MODULE、CHROMIUM_PATH；PLAYWRIGHT_MODULE 应指向可用的 Playwright 模块。独立启动生产服务时，SSR 分享夹具使用 BACKEND_HOST=127.0.0.1、BACKEND_INTERNAL_PORT=3102，公开品牌可使用 BRANDING_FETCH_DISABLED=1。

已通过的流程包括：Worker ready/脚本 200/中文代码与公式、构造失败和无响应的纯文本降级及同页恢复、历史上滚保锚、停止/错误最终缓存、切会话恢复、万行 CoT 折叠仅 3 个 span 与展开全文、设置首次打开、个人设置 hash 和 back/forward、分享与 Battle 公共渲染器。

个人 Skills 深链的首次失败来自测试夹具：商店接口返回数组，而契约是含 items/sources 的对象。修正夹具后深链与历史导航通过。后续视觉检查将 KaTeX CSS/字体请求映射到已安装包，避免公网 CDN 时序影响截图；加载态检查清除测试身份缓存并确认不显示历史正文。

最终重建后 smoke exit0；页面未捕获异常为零。移动端九行输入高度 200px，清空回到 64px。桌面、移动、公式、代码、CoT、设置、分享/Battle 和身份等待骨架截图已直接查看，未发现阻塞交付的可见问题。比较限定同机、同浏览器、同窗口、25888 字符、25 次更新、48 ms cadence；指标为合成帧间隔与长任务，不是正式 INP，也不代表线上普遍耗时。

| 指标 | 基线 | 最终修复 |
| --- | ---: | ---: |
| 帧间隔 p95 | 138.8 ms | 62.5 ms（下降55.0%） |
| 长任务数量 | 25 | 3 |
| 最长长任务 | 149 ms | 55 ms |
| 脚本 transfer bytes | 850679 | 549042 |
| 脚本 decoded bytes | 2660129 | 1765320 |
| 最终 Markdown HTML cache | 空 | 非空，来源25938字符，末尾可见 |

最后一轮导航含 networkidle 等待为3707→1895ms，仅单次合成观测，不作为稳定首屏耗时改善承诺。中间一轮曾测得34.6ms，本报告采用最终重建后62.5ms，不选择最优样本。

## 环境限制与失败记录

- Windows 原生 standalone 复制阶段遇到 symlink EPERM。仓库外临时适配曾使用 junction，后续清理产物穿透 junction 损坏共享依赖；已停止相关进程并以 pnpm install --frozen-lockfile --force 恢复。最终适配只复制目录，不再创建 junction，未提交适配文件。
- 最终生产 build 在上述 Windows 复制适配下通过；尝试 standalone server.js 启动仍报缺少 styled-jsx/package.json。因此本次运行验收以 next start 为准，不能声称原生 standalone 或 Linux Docker 运行已通过。
- tsc 与 build 串行执行，避免 .next/types 被清理时造成 TS6053；修复环境后独立 tsc 已通过。
- 未修改生产账号设置、未向线上发送测试聊天，未修改部署配置；推送不等于线上已部署。

## 合并交付

最终浏览器结果、提交与远端核对待收口后回填。
