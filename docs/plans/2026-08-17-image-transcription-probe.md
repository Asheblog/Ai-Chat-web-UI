# Image Transcription Probe + Reasoning Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 管理员可在图片转写设置页一键验证转写与网页图相关性链路，并为转写识图调用配置思考模式/强度。

**Architecture:** 扩展 `VisionProxyConfig` 的 reasoning 字段并由 `VisionProxyService` 注入 provider 参数；新增管理员 `POST /api/settings/image-transcription/probe` 编排转写 + `assessWebImageRelevance` 两步探针；设置卡暴露思考控件与测试结果；相关性失败打 warn 日志。

**Tech Stack:** Hono + Zod、Prisma settings map、Vitest/Jest、React FeatureCard、`@aichat/shared` settings-contract

**Design:** `docs/plans/2026-08-17-image-transcription-probe-design.md`

**Seams (TDD):**
1. `loadVisionProxyConfig` / reasoning apply on request body
2. probe use-case / API response shape
3. `assessWebImageRelevance` warn-on-failure
4. settings read/write for new keys
5. ImageTranscriptionCard UI (thinking + probe button)

---

### Task 1: Extend VisionProxyConfig + apply reasoning in VisionProxyService

**Files:**
- Modify: `packages/backend/src/modules/chat/services/vision-proxy-service.ts`
- Modify: `packages/backend/src/modules/chat/services/vision-proxy-service.test.ts` (or create if missing patterns)
- Test: same

**Step 1: Write failing tests**

- `loadVisionProxyConfig` reads:
  - `image_transcription_reasoning_enabled`
  - `image_transcription_reasoning_effort`
  - `image_transcription_ollama_think`
  - defaults: enabled=false, effort=`unset` (or empty → treat as no effort), ollamaThink=false
- When `transcribeImages` with reasoning enabled + effort `high` + openai-like provider, fetch body includes `reasoning_effort: 'high'`
- When ollama + reasoning + ollamaThink, body includes `think: true`
- When vendor deepseek/openai_interleave connection... (if connection has no vendor field, skip thinking type OR read from connection if available — match title-summary / chat-request-builder; if VisionProxy only has `provider`, apply `reasoning_effort`/`think` only for openai/ollama paths; for deepseek-as-openai keep reasoning_effort)

**Step 2: Run tests — expect FAIL**

**Step 3: Minimal implementation**

```ts
export interface VisionProxyConfig {
  enabled: boolean
  connectionId: number | null
  modelId: string | null
  reasoningEnabled: boolean
  reasoningEffort: string // '' or unset means no effort field
  ollamaThink: boolean
}
```

Extract small `applyVisionReasoningOptions(body, config, provider)` mirroring chat-request-builder rules (effort when enabled && effort not empty/unset; think for ollama; thinking type only if we have vendor — VisionProxy may only know provider; apply effort to chatBody before provider transforms; for ollama set `think` on body).

**Step 4: Tests PASS**

**Step 5: Commit** `feat(vision-proxy): apply transcription reasoning options`

---

### Task 2: Settings contract + service + API zod for new keys

**Files:**
- Modify: `packages/shared/src/settings-contract.ts`
- Modify: `packages/backend/src/services/settings/settings-service.ts`
- Modify: `packages/backend/src/api/settings.ts` (zod update schema)
- Modify: `packages/frontend/src/types/index.ts`
- Modify: `packages/frontend/src/features/settings/api.ts`
- Modify: `.env.example` (optional documented keys)
- Test: `packages/backend/src/services/settings/settings-service.test.ts` (extend)

**Step 1: Failing tests** for get/update of three new keys with defaults

**Step 2–4:** Implement mapping camel ↔ snake; parse boolean/effort; expose to all users same as other imageTranscription fields (needed for readiness UX only — reasoning itself is admin-configured)

**Step 5: Commit** `feat(settings): add image transcription reasoning keys`

---

### Task 3: Probe service + API endpoint

**Files:**
- Create: `packages/backend/src/services/settings/image-transcription-probe-service.ts`
- Create: `packages/backend/src/services/settings/image-transcription-probe-service.test.ts`
- Modify: `packages/backend/src/api/settings.ts`
- Modify: `packages/backend/src/index.ts` (pass visionProxyService into createSettingsApi deps)
- Modify: `packages/backend/src/api/settings.ts` SettingsApiDeps
- Test: `packages/backend/src/api/__tests__/settings-image-transcription-probe.test.ts`

**Behavior:**

```ts
type ProbeStepName = 'transcribe' | 'relevance'
type ProbeStep = {
  name: ProbeStepName
  ok: boolean
  durationMs: number
  detail?: string // description or relevance summary
  error?: string
}
type ProbeResult = { ok: boolean; steps: ProbeStep[] }
```

1. Load system settings map → `loadVisionProxyConfig`; if !ready, return 400 with clear message (or result.ok=false with one step).
2. Resolve image: body.imageBase64 or built-in tiny PNG.
3. Step transcribe: `visionProxy.transcribeImages([{data,mime}], '探针：请简要描述图片。', config)`
4. Step relevance: `assessWebImageRelevance({ candidates: [{ url: 'data:image/png;base64,...' }], contextText: '探针上下文：一张测试图片', visionProxy, visionConfig: config, maxCount: 1 })` — if data URI path fails download, use a path that works: either pass through readRemoteImages support for data URI (already allowed in prefilter) OR call transcribe with RELEVANCE_PROMPT and parseImageRelevance directly for probe to avoid download issues.

**Preferred for reliability:** relevance step calls the same prompt+parse as assessWebImageRelevance but with local image bytes (extract shared helper or call assess with data URI). Verify `readRemoteImages` handles data:image — if not, for probe call `transcribeImages` + `parseImageRelevance` and document that this still validates the model prompt path used by deep research.

5. Never swallow errors in probe; each step catches and records `error` message.
6. HTTP 200 with `{ success: true, data: ProbeResult }` even if ok=false (so UI can show steps); use 4xx only for auth / validation / not configured.

**Route:** `POST /api/settings/image-transcription/probe` + adminOnlyMiddleware + optional zod `{ imageBase64?: string, mime?: string }`

**Step 5: Commit** `feat(settings): add image transcription probe API`

---

### Task 4: Warn log on assessWebImageRelevance failure

**Files:**
- Modify: `packages/backend/src/utils/web-image-evidence.ts`
- Modify: existing `web-image-evidence` tests

**Step 1:** Test that when transcribe throws, logger.warn called and function still returns without throwing

**Step 2–4:** Replace empty catch with warn including url slice + error message

**Step 5: Commit** `fix(web-evidence): log vision relevance assessment failures`

---

### Task 5: Frontend settings API client + ImageTranscriptionCard UI

**Files:**
- Modify: `packages/frontend/src/features/settings/api.ts` (probe client + map new fields)
- Modify: `packages/frontend/src/components/settings/pages/model-connections/ImageTranscriptionCard.tsx`
- Modify: `packages/frontend/src/components/settings/pages/model-connections/__tests__/ImageTranscriptionCard.test.tsx`
- Possibly: `packages/frontend/src/types/index.ts` (if not done in Task 2)

**UI:**
- SettingRow「思考模式」Switch → `imageTranscriptionReasoningEnabled`
- SettingRow「思考强度」Select (unset/low/medium/high/max/xhigh) → effort
- SettingRow「Ollama Think」Switch → ollamaThink
- Footer or below: Button「测试转写代理」disabled when !enabled || !connectionId || !modelId || probing
- Result panel: overall ok + per-step ok/duration/detail/error

**Step 5: Commit** `feat(settings-ui): probe button and transcription reasoning controls`

---

### Task 6: CONTEXT.md note + verification

**Files:**
- Modify: `CONTEXT.md` — under Vision Transcription Proxy bullet, mention probe + reasoning keys briefly
- Run backend + frontend tests for touched files
- Self-check: no secrets in probe response

**Step 5: Commit** `docs: note image transcription probe and reasoning`

---

### Task 7: Final review + merge prep

- Run code-review skill (Standards + Spec)
- Fix any Critical/Important
- Use finishing-a-development-branch

---

## Execution

User approved design; execute with **Subagent-Driven Development** in this session (workspace rule).
