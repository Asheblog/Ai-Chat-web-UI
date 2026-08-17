# Deep Research Composer Toggle — Design

Date: 2026-08-17

## Goal

在聊天输入框工具栏（桌面 + 移动共用）增加「深度研究」独立开关，发送时把 `deep-research` 写入 `skills.builtin`，让已实现的后端深度研究流程可被用户发现并启用。

## Decisions

1. 与「联网」同级的独立开关（非 Skill 面板、非互斥模式）。
2. 打开深度研究时不强制点亮/锁定「联网」；payload 仅需 `deep-research`（后端自行激活搜索工具；无搜索走既有降级）。
3. 默认关闭；localStorage persist 记忆偏好。
4. 按钮始终可点（不因缺搜索 API Key 禁用）。
5. 位置：联网之后、Python 之前；图标 Lucide `Microscope`（依赖版本无 Telescope）；文案「深度研究」。
6. 覆盖会话 composer + 欢迎页；对战 Battle 本轮不做。
7. 无新增后端 API / 无系统设置页 / 无迁移。

## Approach

复用 `ComposerFeatureControls` + `useComposerFeatureFlags` + preference store 模式（对齐联网/Python）。
