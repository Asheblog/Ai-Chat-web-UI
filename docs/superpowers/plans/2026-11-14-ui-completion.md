# Ink & Mist 完整界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development.

**Goal:** 先完善 Figma 的页面与组件细节，再完整落地前端并回归到可构建主分支。
**Architecture:** 保留数据层与业务回调，以现有公共组件为 seam；输入与选择器、设置、外围页面独立写入。Figma 单一所有者为 lead。
**Tech Stack:** Next.js 15 / React 18 / Tailwind 3 / Radix / Vitest / Figma native Plugin API.
**Spec:** docs/design/ui-completion-ink-mist.md

## Global Constraints

- 不添加依赖、不修改认证/模型/设置 API 语义、不做全库字符串替换。
- 使用现有 Ink & Mist token；公共组件保持回调与键盘/ARIA 语义。
- 不覆盖其他执行者文件。既有用户授权：并行完成全部改造，测试后推送 main 并确认 CI。

## Review Focus

见 spec 的五项输入/状态边界；每个实现者补齐其负责边界的回归。

## Tasks

- [x] 1. lead：审计、Figma 原页面约束修复；建立模型选择器/输入区完整组件与宽窄明暗状态；按实际图像修正。
- [x] 2. chat owner：components/model-selector、components/chat 的输入相关模块、features/chat/welcome，先写失败交互/布局断言，再按设计实现。验证项目 Vitest 相关用例，长名不压缩 send、收藏不误选、搜索/键盘/移动关闭正常。
- [x] 3. settings owner：components/settings、features/settings，统一页头/导航/密度/状态、保留各页原有即时或批量显式保存机制，补适配与交互回归。
- [x] 4. shell/pages owner：sidebar、app-shell、auth、battle、logs/trace/share，统一布局和状态，不修改数据协议。
- [x] 5. lead：实际浏览器 fixture 验证已加载模型/真实消息/交互；独立 Standards 和 Spec review，修复具体问题。
- [ ] 6. 全量 vitest/type-check/build/architecture，更新证据；提交、推送 main、监督四项 CI。

## Rulings

- 直接沿用用户的并行实施方式与本轮继续完善要求，不重复确认已经确定的方向。
- 用户升级会员后已实际创建第四页「03 · 组件与状态」（22:814）；组件板21:2与暗色选择器22:663迁入。后续按页面职责整理，不再沿用三页限额假设。

- Ruling: 六页按职责整理，原生组件与实例ID保持 — 用户升级后已实际创建并重新连接确认 — 错判代价是重复生成或遗失设计内容。
- Ruling: 保留高级/推理网络原有整页显式保存，个人字段即时保存 — 真实业务比初稿笼统表述优先 — 错判代价是丢失设置提交边界。
- Ruling: 侧栏仅保留顶部新建聊天，其他入口移至footer quiet nav — 首版实图仍偏离设计且用户明确要求完整改造 — 路由、权限和快捷键保持。
- Ruling: 加载骨架、仅导航激活与超时截图不计内容验收 — 实图发现system-models仍在加载 — 必须等待真实表单后补图。

## Review Repairs

| 轴 | 发现 | 负责人 | 状态 |
|---|---|---|---|
| Spec P1 | Welcome模型空/error导致入口禁用、恢复不可达 | ui-composer-v2 | 已修，3项红→绿；模型三宽empty/error刷新恢复6run通过 |
| Spec P2 | 日志手机筛选/分页40px不足44px | ui-settings-v2 | 已修，日志7项回归通过 |
| Spec P2 | stale日志展示页与下一页请求基准分裂 | ui-settings-v2 | 红测与修复中 |
| 浏览器 | textarea双focus、输入区过宽、侧栏层级、selector重阴影 | 原owner | 已修，lead实图确认760/单环/右对齐 |

## Verification Log

- 单域：selector 2文件16测；输入12文件47测；设置首轮42文件351测；外围11文件33测通过（覆盖有重叠，不相加）。
- 全量首轮：132文件734测，12失败。包含高并发下超时与SectionRail旧尺寸断言；未记为通过。尺寸已按44px修复，低并发完整回归进行中。
- 浏览器：首批输入/selector实际模型+消息交互证据有效；系统懒加载叶子仅导航的旧截图作过渡态，正在补真实内容。

- 全量低并发：132文件734测试通过；随后三项审查修复定向通过，最终完整回归133文件740测试通过。
- Standards独立审查无新增P1/P2；Spec三项已归原owner修复，保存/认证/pass@k边界未发现越界。
- 架构检查OK（4package、无环、API db-free）；shared build通过。最终type-check在模型恢复测试类型修复后通过。
- 实屏归档：`docs/design/assets/ui-v2/browser/` 包含有效会话1440、Welcome320dark、系统概览及日志展开图。系统动态页面以真实DOM/card锚点补验，旧仅导航证据已撤销。

- 最终实屏：系统十叶1440/390/320明暗真实内容、模型空错6run恢复、对战配置至题目、追踪详情3事件通过。分享Markdown确认worker初始化中间态，生产零变更；仅补ready锚点最终图。
- PersonalSecurity三输入与保存按钮mobile44尺寸红→绿回归通过，390实际展开表单图通过。

- 本地最终关口：133文件740测试、前端type-check、架构、shared构建、18路由production build均通过。Browser ALL FINISHED；代表图已归档。远端发布关口以本轮main提交的Build and Push Images记录为准。
