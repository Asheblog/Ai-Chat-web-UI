# Image Transcription Probe + Reasoning Controls — Design

Date: 2026-08-17

## Goal

为系统设置「图片转写代理」增加管理员一键场景探针（转写 + 网页图相关性），并补齐转写识图调用的思考模式 / 强度配置；顺带让深度研究识图失败可观测（warn 日志）。

## Decisions

1. **测试深度 = 场景探针（B）**：连通性转写 + `assessWebImageRelevance` 路径；不跑完整深度研究端到端。
2. **探针入口**：`POST /api/settings/image-transcription/probe`（管理员）；设置卡「测试转写代理」按钮。
3. **样图**：服务端内置 1×1（或小图）PNG base64；请求可可选覆盖 `imageBase64` + `mime`。
4. **fail-loud**：探针任一步失败返回结构化错误原文；不吞错。
5. **思考配置**（仅作用于 `VisionProxyService` 识图请求，默认关）：
   - `image_transcription_reasoning_enabled`（bool, default false）
   - `image_transcription_reasoning_effort`（`low|medium|high|max|xhigh|unset`, default unset）
   - `image_transcription_ollama_think`（bool, default false）
6. **线上相关性 catch**：仍 skip，但打结构化 warn（不再空 catch）。
7. **无迁移**：缺省键即默认值；不改连接 URL/Key 模型。
8. **不做**：完整深度研究干跑、移动端设置、主聊天思考 UI 改动。

## Approach

- 扩展 `VisionProxyConfig` / `loadVisionProxyConfig` 携带 reasoning 三字段；`transcribeImages` 按与主聊天一致的 provider 规则注入 `reasoning_effort` / `thinking` / `think`。
- 新增 `ImageTranscriptionProbeService`（或 settings facade 方法）编排两步探针，复用 `VisionProxyService` + `assessWebImageRelevance`。
- 设置卡：思考开关 + 强度 + Ollama think；底部测试按钮与结果区。
- 契约：`settings-contract` / frontend types / settings API zod / settings-service 读写。

## Out of scope

- 改变相关性失败时的产品语义（仍 skip）
- 独立 API URL/Key
- Battle / 移动端
