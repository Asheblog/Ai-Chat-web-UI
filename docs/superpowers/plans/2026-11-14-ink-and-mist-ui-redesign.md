# Ink & Mist 视觉改版实施计划

日期：2026-11-14 · 设计规范：docs/design/ui-redesign-ink-mist.md · 决策：ADR-0042

## 目标
把现有 Claude 风暖色 UI 换成 Ink & Mist（中性骨架 + 信号色），覆盖聊天、设置、乱斗、日志、登录与移动端断点；改完 type-check / 单测 / next build / CI 全绿。

## 关键取舍
保留 shadcn 变量名，替换取值 + 新增少量语义变量。原因：200+ 文件引用旧类名，全量改名风险远大于收益；品牌主题注入契约不受影响。

## 波次与写入范围（互斥）

### Wave 1 · Token 层（agent: tokens）
- packages/frontend/src/app/globals.css
- packages/frontend/tailwind.config.ts
- docs 映射表与 ADR 实现注记

### Wave 2 · 基础件与壳层（并行 3 个）
- agent ui-kit：packages/frontend/src/components/ui/**（button / input / textarea / select / switch / card / table / badge / dialog / dropdown-menu / tooltip / scroll-area / separator / label / checkbox / sheet / skeleton / command / toast）
- agent shell：components/sidebar.tsx、components/app-shell.tsx、app/main/layout.tsx、components/user-menu.tsx、components/sidebar-toggle-icon.tsx、components/sidebar-session-search.tsx
- agent chat-surface：components/chat/**（composer-shell、chat-composer-panel、chat-toolbar、chat-message-row、desktop/mobile composer、composer-shell-styles、share-dialog 等）+ features/chat/welcome/** + components/welcome-screen.tsx

### Wave 3 · 内容与页面（并行 3 个）
- agent message-bubble：components/message-bubble/** + components/message-list.tsx + markdown-renderer.tsx + syntax-highlight.tsx + terminal-code-block.tsx
- agent settings：components/settings/**（shell、nav、pages）+ app/main/settings/** + components/personal-settings.tsx + system-settings.tsx
- agent pages：app/main/battle/** + features/battle/** + app/main/logs/** + components/task-trace/** + app/auth/** + components/auth-form-layout.tsx

## 每个 agent 的硬约束
1. 只改自己范围内的文件；跨范围需求写进回报，由我统一处理。
2. 不新增依赖；不改导出的组件 API 与 props（调用方不动）。
3. 行为与文案语义不变，只改视觉与布局密度；交互（hover/focus/disabled/loading/empty）必须补齐。
4. 单文件行数不超过 300（已超的文件不得继续增长，需拆分时先回报）。
5. 自测：pnpm --filter @aichat/frontend type-check 必过；改动目录有测试就跑对应 vitest。
6. 交付含：文件清单、关键改动、验证输出、截图（playwright-cli，output/playwright/）。

## 验收关口（我执行）
1. pnpm architecture:check
2. pnpm --filter @aichat/shared build
3. pnpm --filter @aichat/frontend exec vitest run --reporter=dot
4. pnpm --filter @aichat/frontend type-check
5. pnpm --filter @aichat/frontend build（next build，等同 CI 镜像构建阶段）
6. playwright 截图核对 6 条路由 × 浅/深色 × 1440/390
7. code-review 双轴（Standards / Spec）后修复
8. 合并到 main 并推送，盯 GitHub Actions（quality + 镜像构建）到绿

## 风险
- 样式改动导致既有单测快照/类名断言失败：优先改样式兼容断言，不修改测试意图。
- next build 与 dev 行为差异（tailwind JIT / 动态类名）：以 build 为准。
- 并行代理互相覆盖：写入范围已互斥，收口前我统一 review diff。