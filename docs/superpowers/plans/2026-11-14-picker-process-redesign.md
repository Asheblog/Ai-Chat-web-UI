# 模型选择器与过程展示全面改造

> For agentic workers: use scoped parallel implementation, then independent code review. 用户已批准 Figma 稿并明确同意全面改造；不再重问已定方向。

**Goal:** 将已确认设计落地为真实、可访问的桌面与手机界面。

**Architecture:** 保留 ModelSelector 公开入口、模型连接身份和真实选择回调；内部替换为搜索加扁平列表。CoT 使用现有时间线数据，重做摘要和步骤布局，不修改模型响应数据含义。

**Tech Stack:** Next.js、React、TypeScript、Tailwind、Radix、Vitest。

**Spec:** Figma XDfw2oAOJT0O8uGNlATpsw，页面 0:1；模型板 1:2；过程板 1:58；窄屏状态板 1:156。节点及预览见 .figma/design-redesign-state.json。

## Global Constraints
- 模型列表只展示模型名、供应商、当前选择标识；仅保留搜索，移除侧栏、收藏/最近/能力筛选及重复常用区。
- 名称相同但连接不同的模型保留独立身份；搜索覆盖模型和供应商；选择立即生效。
- 保留禁用、加载、错误、无模型、搜索无结果和重试的真实行为；重试不增加日常筛选入口。
- CoT 默认完成态一行摘要：状态、耗时、查看过程；按需展开有序步骤及已有详情。运行态显示真实当前活动，不虚构百分比。
- 首屏 7 步，其余通过查看更多展开；消除面板内部嵌套滚动。保持失败信息及已有思考/工具内容访问。
- 沿用 globals.css 语义 tokens、公共组件、中文、UTF-8。375px 与桌面均可使用，焦点可见，键盘可达。
- 不改后端接口、数据库、品牌设置；不提交或推送。

## Review Focus
- 同名模型来自不同连接时仍选择正确实例，供应商文案准确。
- 键盘选择、Esc 关闭与焦点回退在桌面和手机一致。
- 历史消息不自动撑开；运行结束不覆盖用户主动展开；实时步骤更新正确。
- 仅有推理或工具、部分失败、长步骤、长模型名、搜索无结果均可读可恢复。
- 原调用方的约束和能力过滤仍有效；仅移除普通选择器多余的筛选 UI。

## Task 1 · Model picker (独立 write scope)
Files: packages/frontend/src/components/model-selector/**，必要时相邻公开包装器的最小更改需协调。
Interfaces: 保持 ModelSelector props、model identity、onChange 契约。
- [x] 先新增失败测试：模型+供应商、搜索、同名不同连接、无多余筛选、键盘和空状态。
- [x] 运行模块测试得到 red；实现扁平列表、搜索、桌面 Popover/手机 Sheet。
- [x] 模块测试 green；移除仅服务旧 UI 的冗余内部代码并更新模块 README。

## Task 2 · CoT (独立 write scope)
Files: packages/frontend/src/components/message-bubble/*cot*、use-cot-timeline-level.ts、相关测试。
Interfaces: 保留 CotTimeline props 和事件顺序；新语义只涉及呈现。
- [x] 先新增失败测试：完成折叠、运行活动、逐步详情、7 步阈值、失败和历史内容。
- [x] 运行 red；替换摘要/步骤布局，删除内层滚动，保留现有详情呈现。
- [x] 模块测试 green；保留有用的原契约回归。

## Task 3 · Integration and acceptance (lead)
Files: 本计划、docs/adr/、CONTEXT.md/CONTEXT-MAP.md 相关条目、必要 dev 预览路由。
- [x] 维护本次交互规则 ADR，复用实际数据或显式测试 fixtures，不动凭证。
- [x] 运行 pnpm --filter @aichat/frontend test --run；type-check；lint。记录全部失败并修复本次问题。
- [x] 项目自身 dev server 上验收模型默认/搜索/选择/空/错误、过程折叠/展开/运行/失败；宽屏及375px截图。
- [x] 独立 Standards+Spec 审查，修复实质问题，检查最终 diff。

## Execution record
- 设计与实施范围已经用户明确批准；模块并行实现，lead负责集成和浏览器验收。
- 模型模块及调用方定向回归25/25；CoT及分享39/39。两轴独立审查的失败定位、焦点、读屏耗时和虚拟卸载记忆均已修复。
- 2026-11-14 最终完整前端检查：134文件、759项通过（Vitest 171.26s，maxWorkers=2）；tsc --noEmit及next lint均exit0。lint仍有仓库既有非阻断警告。
- 桌面1440px与375px真实Chromium验收通过；默认/搜索/键盘/选择/错误/空目录恢复/加载/深色/长文本，及过程摘要/7步/更多/单步详情/失败导航/运行/重挂载记忆已检查。最终运行无pageerror及HTTP4xx/5xx。
- Ruling: 普通展开首屏7步；失败入口可按需披露至首个失败节点 — 定位真实失败比机械限制7步更重要，原顺序保持 — 错判代价为用户需手动查找失败。
- 验收使用开发专用fixtures及真实组件，不发起付费模型请求。历史/分享/Battle调用约束由组件回归与独立Spec审查覆盖；生产部署不属于本轮。
- 完整证据见 docs/superpowers/plans/2026-11-14-picker-process-acceptance.md；无迁移、直接替换。
