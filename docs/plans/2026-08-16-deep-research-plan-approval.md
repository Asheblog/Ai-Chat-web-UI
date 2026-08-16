# Deep Research Plan Approval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive, persisted deep-research plan approval flow to the existing agent tool loop without a new database table.

**Architecture:** `research_plan` becomes a normal built-in tool handler that blocks the tool orchestrator on an in-memory approval registry; approval actions resolve it via a new chat stream endpoint. Terminal decisions surface as tool-event state transitions plus a `complete` chunk carrying `streamStatus`. The Web client renders the plan as a special card in the existing CoT timeline. No-search fallback reuses the same synthetic tool-event/approval card before the model turn.

**Tech Stack:** Hono + zod (backend), Zustand + React/Next.js + Tailwind (frontend), `@aichat/shared` contracts, Jest + Vitest, pnpm workspaces.

---

## Definitions

- `research_plan` tool name: `research_plan`
- Timeout: `RESEARCH_PLAN_APPROVAL_TIMEOUT_MS = 5 * 60_000`
- Max adjustment rounds: `MAX_RESEARCH_PLAN_REVISIONS = 2`
- Terminal codes:
  - `research_plan_cancelled` — user cancelled or disconnect
  - `research_plan_expired` — 5-minute timeout
  - `research_plan_required` — model skipped the plan twice

### Tool event state transitions

| event | stage | status | phase | summary |
|---|---|---|---|---|
| pending plan | start | pending | pending_approval | 等待确认研究计划 |
| approved | result | success | result | 研究计划已确认 |
| adjust accepted | result | success | result | 已收到调整意见，正在重新生成计划 |
| cancelled | error | rejected | rejected | 深度研究已取消 |
| expired | error | aborted | aborted | 研究计划已过期 |
| no-search pending | start | pending | pending_approval | 联网搜索不可用，是否基于已有知识继续？ |
| no-search continue | result | success | result | 已选择基于已有知识继续 |

---

### Task 1: Shared contract and domain types

**Files:**
- Modify: `packages/shared/src/chat-stream-contract.ts`
- Modify: `packages/shared/src/tool-events.ts`
- Test: `packages/shared/src/chat-stream-contract.test.ts` (create)

**Step 1: Write failing tests**

Create `packages/shared/src/chat-stream-contract.test.ts` asserting:
- `parseChatStreamChunk` (already exported) keeps `streamStatus` on a `complete` payload
- `describeTool('research_plan') === '研究计划'`
- `describeTool('export_pdf') === 'PDF 导出'`

**Step 2: Run test and verify fail**

Run `pnpm --filter @aichat/shared build` first to regenerate dist? No—tests in this repo run against source for frontend/backend; shared has no test runner configured. Instead extend existing parser test in `packages/frontend/src/features/chat/api/__tests__/stream-reader-execution.test.ts` or backend `chat-stream-parser` tests. Verify the new assertion fails against current parser.

**Step 3: Implement**

In `chat-stream-contract.ts`:
- add `streamStatus?: 'done' | 'cancelled' | 'error'` to `ChatStreamChunk`
- add `plan?: ResearchPlanPayload` and `approval?: ResearchPlanApprovalState` to `ToolEventDetails`
- export:
  - `ResearchPlanSubQuestion { question: string; keywords: string[] }`
  - `ResearchPlanPayload { title; objective; sub_questions; estimated_tool_rounds {min,max}; deliverable?; notes? }`
  - `ResearchPlanApprovalState { kind: 'plan'|'search_unavailable'; decision?; feedback?; revision?; expiresAt? }`

In `tool-events.ts` add labels:
- `research_plan` -> `研究计划`
- `export_pdf` -> `PDF 导出`

In `chat-stream-parser.ts` complete branch return `streamStatus` when present.

**Step 4: Run tests and verify pass**

Run backend `pnpm --filter @aichat/backend test -- testPathPatterns=chat-stream-parser` and frontend `pnpm --filter @aichat/frontend test -- stream-reader` (or closest existing suites). Then `pnpm --filter @aichat/shared build`.

**Step 5: Commit** `feat(deep-research): add plan approval shared contract types`

---

### Task 2: Backend approval registry

**Files:**
- Create: `packages/backend/src/modules/chat/research-plan-approval.ts`
- Test: `packages/backend/src/modules/chat/__tests__/research-plan-approval.test.ts`

**Step 1: Write failing tests**

Tests for:
- `registerResearchPlanApproval` + `respondResearchPlanApproval` resolves `approve` with feedback payload
- unknown toolCallId throws 404 typed error
- duplicate register for same `sessionId+toolCallId` throws 409
- `cancelResearchPlanApprovalsForSession` resolves all pending entries with `cancelled`
- timeout path resolves `expired` after fake timer advance (Jest fake timers)

**Step 2: Run and verify fail**

`pnpm --filter @aichat/backend test -- --runInBand research-plan-approval.test.ts`

**Step 3: Implement**

Pure in-memory module:
- `Map<string, PendingResearchPlanApproval>` keyed `${sessionId}:${toolCallId}`
- `registerResearchPlanApproval(input)` validates actor/session and returns entry
- `respondResearchPlanApproval({sessionId, toolCallId, actorIdentifier, decision, feedback})`
- `cancelResearchPlanApprovalsForSession(sessionId)`
- `waitForResearchPlanApproval(entry, {timeoutMs, signal})` returns
  `{ decision: 'approve'|'adjust'|'cancel'|'continue'|'expired', feedback?, revision? }`
- use `ResearchPlanApprovalError` with `statusCode`
- cleanup always in `finally`

**Step 4: Run tests and verify pass**

**Step 5: Commit** `feat(deep-research): add in-memory research plan approval registry`

---

### Task 3: research_plan tool handler

**Files:**
- Create: `packages/backend/src/modules/chat/research-plan-tool.ts`
- Create: `packages/backend/src/modules/chat/tool-handlers/research-plan-handler.ts`
- Modify: `packages/backend/src/modules/chat/tool-handlers/types.ts`
- Modify: `packages/backend/src/modules/chat/tool-handlers/registry.ts`
- Modify: `packages/backend/src/modules/chat/tool-handlers/index.ts`
- Test: `packages/backend/src/modules/chat/tool-handlers/research-plan-handler.test.ts`

**Step 1: Write failing tests**

Handler tests with an injected fake gate:
- validates and rejects invalid args (empty title, fewer than 3 subquestions, empty keyword)
- emits `start/pending/pending_approval` with `details.plan`
- on gate `approve` emits result event and returns tool message `status: approved`
- on gate `adjust` returns `status: revision_requested` and feedback
- on gate `cancelled` returns result with `termination.code === 'research_plan_cancelled'`
- on gate `expired` returns result with `termination.code === 'research_plan_expired'`

**Step 2: Run and verify fail**

**Step 3: Implement**

`research-plan-tool.ts`:
- `RESEARCH_PLAN_TOOL_NAME`
- `RESEARCH_PLAN_TOOL_DEFINITION` (OpenAI function schema)
- `parseResearchPlanArgs(args)` with clamp/validate rules from spec

`research-plan-handler.ts`:
- `ResearchPlanToolHandler` implements `IToolHandler`
- `DeepResearchPlanHandlerConfig { enabled: boolean; approvalGate: ResearchPlanApprovalGate }`
- `ResearchPlanApprovalGate { waitForDecision(input): Promise<ResearchPlanApprovalDecision> }`
- terminal decisions are returned as `ToolHandlerResult.termination`, not thrown

`types.ts`:
- add `termination?: { code: 'research_plan_cancelled'|'research_plan_expired'|'research_plan_required'; message: string }`
- add `DeepResearchPlanHandlerConfig`, `ResearchPlanApprovalGate`, decision types
- add `deepResearchPlan?: DeepResearchPlanHandlerConfig | null` to `ToolHandlerFactoryParams`

`registry.ts`: register `ResearchPlanToolHandler` when `params.deepResearchPlan?.enabled`.

**Step 4: Run tests and verify pass**

**Step 5: Commit** `feat(deep-research): add research_plan tool handler`

---

### Task 4: Orchestrator supports iteration, blocked tools, and termination

**Files:**
- Modify: `packages/backend/src/modules/chat/tool-orchestrator.ts`
- Test: `packages/backend/src/modules/chat/__tests__/tool-orchestrator.test.ts`

**Step 1: Write failing tests**

- `handleToolCall` receives `iteration` (assert sequence)
- when a handler returns `termination: research_plan_cancelled`, orchestrator returns status `terminated` and does not request another turn
- same for functions and text schema paths
- blocked tool result flows through with iteration available

**Step 2: Run and verify fail**

**Step 3: Implement**

- extend `ToolOrchestrationResult` with `status: 'terminated'; termination; usage; messages; reasoningChunks; toolSchema`
- extend `handleToolCall` signature with optional `iteration?: number`; pass `iteration` from every `executeToolCall` call
- `executeToolCall` forwards iteration
- after collecting settled results in functions/text/tools branches, scan for `result.value.termination` and return terminated immediately
- keep all existing behaviour for non-termination results

**Step 4: Run tests and verify pass**

**Step 5: Commit** `feat(deep-research): teach tool orchestrator plan terminations`

---

### Task 5: Prompt and tool flag wiring

**Files:**
- Modify: `packages/backend/src/modules/chat/services/chat-request-builder.ts`
- Modify: `packages/backend/src/modules/chat/use-cases/chat-stream-use-case.ts`
- Modify: `packages/backend/src/modules/chat/agent-tool-config.ts` (only if `toolFlags.deepResearch` needs export)
- Test: `packages/backend/src/modules/chat/services/__tests__/chat-request-builder.test.ts`
- Test: `packages/backend/src/modules/chat/__tests__/agent-tool-config.test.ts`

**Step 1: Write failing tests**

- builder with `deepResearchWebSearchActive: true` contains `research_plan` and “必须调用”
- builder with `deepResearchWebSearchActive: false` contains “不要调用 research_plan” and unverified wording
- agent tool flags remain unchanged for existing cases

**Step 2: Run and verify fail**

**Step 3: Implement**

In `PrepareChatRequestParams` add `deepResearchWebSearchActive?: boolean`.
Replace the deep-research prompt block with two variants:
- active: strict first-call `research_plan` workflow; after approval then web_search/read_url; final report + export_pdf
- inactive: no `research_plan`/web tools; directly write report from context and label unverified

In `chat-stream-use-case.ts` compute `deepResearchSearchActive` early from requested skills + agent web search config; pass it to `prepare`. Add `deepResearch: agentToolFlags.deepResearchSkillRequested` to `AgentResponseParams.toolFlags` and pass `deepResearch: true` when deep research requested.

**Step 4: Run tests and verify pass**

**Step 5: Commit** `feat(deep-research): enforce plan-first deep research prompt`

---

### Task 6: Wire approval flow into agent response stream

**Files:**
- Modify: `packages/backend/src/modules/chat/agent-web-search-response.ts`
- Test: create focused tests for new helpers extracted to `packages/backend/src/modules/chat/__tests__/agent-research-plan-flow.test.ts` (pure helpers; full SSE integration covered by existing use-case tests where feasible)

**Step 1: Write failing tests**

Extract pure helpers:
- `shouldBlockToolBeforePlan(toolName, iteration, state)` returns block/count behavior
- `buildNoSearchResearchPromptHint` / choice payload helper
- `resolveResearchPlanTerminalChunk(code)` returns complete payload + message
- `buildBlockedToolResult(...)` returns tool role message

**Step 2: Run and verify fail**

**Step 3: Implement**

Inside `createAgentWebSearchResponse`:
1. register `research_plan` handler only when `toolFlags.deepResearch && toolFlags.webSearch`
2. create a mutable `planApprovalState { submitted, approved, revision, blockedIterations }`
3. wrap `handleToolCall`:
   - non-plan tool before approval -> emit `error` tool event and return blocked result; after two blocked iterations return `termination.research_plan_required`
   - `research_plan` passes through; approval gate sets `approved=true` on `approve`
4. approval gate:
   - register in-memory entry keyed by `sessionId + toolCallId`
   - wait with `timeoutMs=RESEARCH_PLAN_APPROVAL_TIMEOUT_MS`
   - `requestSignal` abort -> decision `cancel`
   - decision `approve` sets state approved
   - decision `adjust` increments revision and returns feedback
5. no-search path (before `runToolOrchestration`):
   - emit synthetic pending `research_plan` tool event with `approval.kind='search_unavailable'`
   - wait for `continue|cancel|expired`
   - continue -> emit result event and proceed
   - otherwise terminal handling below
6. after `runToolOrchestration`, handle `status === 'terminated'`:
   - cancelled/expired -> set `aiResponseContent` to system message, enqueue
     `{ type:'complete', content, streamStatus:'cancelled' }`, persist `streamStatus:'cancelled'`, trace `cancelled`, return
   - required -> throw friendly error
7. make sure terminal tool events are already recorded by `sendToolEvent` before termination

**Step 4: Run focused + existing tests; verify pass**

**Step 5: Commit** `feat(deep-research): integrate plan approval into chat agent flow`

---

### Task 7: Approval endpoint and cancel integration

**Files:**
- Modify: `packages/backend/src/modules/chat/chat-common.ts`
- Modify: `packages/backend/src/modules/chat/routes/stream.ts`
- Test: `packages/backend/src/api/__tests__/chat-stream-research-plan-respond.test.ts`

**Step 1: Write failing tests**

Hono route tests with mocked approval registry:
- valid approve returns `{ success: true }`
- adjust without feedback -> 400
- unknown toolCallId -> 404
- actor mismatch -> 404/403
- cancel stream route also cancels pending plan approvals for that message

**Step 2: Run and verify fail**

**Step 3: Implement**

`chat-common.ts`: add `researchPlanRespondSchema`
```
sessionId, toolCallId, decision enum, feedback optional, refine feedback required for adjust
```
`routes/stream.ts`:
- `router.post('/stream/research-plan/respond', actorMiddleware, zValidator('json', researchPlanRespondSchema), ...)`
- resolve actor, call `respondResearchPlanApproval`, return `ApiResponse`
- in existing `/stream/cancel` after `matchedMeta` found: call
  `cancelResearchPlanApprovalsForMessage(sessionId, messageId, clientMessageId, assistantClientMessageId)`

**Step 4: Run tests and verify pass**

**Step 5: Commit** `feat(deep-research): add plan approval endpoint`

---

### Task 8: Frontend parser, API, and plan card

**Files:**
- Modify: `packages/frontend/src/features/chat/api/streaming.ts`
- Modify: `packages/frontend/src/features/chat/store/slices/stream-slice.ts`
- Modify: `packages/frontend/src/features/chat/store/runtime.ts`
- Create: `packages/frontend/src/components/message-bubble/research-plan-card.tsx`
- Modify: `packages/frontend/src/components/message-bubble/cot-timeline.tsx`
- Modify: `packages/frontend/src/hooks/use-chat-composer.ts`
- Test: `packages/frontend/src/components/message-bubble/__tests__/research-plan-card.test.tsx`
- Test: stream-slice test additions

**Step 1: Write failing tests**

- API function posts decision payload to `/chat/stream/research-plan/respond`
- complete chunk with `streamStatus:'cancelled'` marks message meta cancelled
- plan card renders subquestions and emits approve/continue on click
- expired historical card renders `重新发起` and dispatches `aichat:composer-prefill`

**Step 2: Run and verify fail**

**Step 3: Implement**

`streaming.ts`: `respondResearchPlanApproval(sessionId, toolCallId, decision, feedback?)`

`stream-slice.ts` complete branch:
- read `evt.streamStatus`
- set `active.pendingMeta.streamStatus = evt.streamStatus` when present

`runtime.ts` flush: apply `pendingMeta.streamStatus` to meta; recompute streaming flag after flush.

`research-plan-card.tsx`:
- read `event.details.plan` / `event.details.approval`
- interactive only when `event.status==='pending'` and `isStreaming`
- actions: approve, adjust (textarea, disabled empty), cancel; no-search variant: continue/cancel
- countdown from `approval.expiresAt`
- terminal states read-only; expired has `重新发起` which finds previous user content in chat store and dispatches `aichat:composer-prefill`
- use Lucide icons, design tokens, no emoji icons

`cot-timeline.tsx`: when tool node is `research_plan`, render `CotResearchPlanCard` wrapper with dot/timeline positioning and auto-scroll on pending.

`use-chat-composer.ts`: listen for `aichat:composer-prefill`, set input and focus.

**Step 4: Run frontend tests and type-check; verify pass**

**Step 5: Commit** `feat(deep-research): render research plan approval card`

---

### Task 9: Share/history guardrails and docs

**Files:**
- Modify: `packages/backend/src/services/shares/share-service.ts`
- Modify: `packages/frontend/src/components/chat/chat-message-viewport.tsx`
- Modify: `packages/backend/src/modules/chat/tool-logs.ts` if history projection drops `plan`/`approval` keys
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-08-15-deep-research-report-pdf.md` (link new spec)
- Test: share-service rejection test, viewport filter test, tool-logs projection test

**Step 1: Write failing tests**

**Step 2: Run and verify fail**

**Step 3: Implement**

Share service:
- when creating a share, reject selected messages whose `toolLogsJson` contains a `research_plan` event with `status: rejected|aborted` and `streamStatus` is `cancelled|error`; error message explains the message cannot be shared
- share snapshot already includes tool events, so completed plans render statically in `ShareViewer`

Viewport:
- filter `shareSelectableMessageIds` to exclude assistant messages whose tool events include terminal research plan states

Tool logs:
- ensure `HISTORY_LIST_DETAIL_KEYS` includes `plan` and `approval` so the slim history projection preserves plan card data.

Docs:
- Add `Research Plan Approval`, `Research Plan Card`, `Research Plan Approval Registry`, `No-search Fallback Choice` terms to `CONTEXT.md`
- Link new spec from the original deep-research implementation plan.

**Step 4: Run tests and verify pass**

**Step 5: Commit** `feat(deep-research): enforce share guardrails and update docs`

---

### Task 10: Full verification, code review, merge and push

**Steps**
1. `pnpm --filter @aichat/shared build`
2. `pnpm --filter @aichat/backend test -- --runInBand`
3. `pnpm --filter @aichat/backend type-check`
4. `pnpm --filter @aichat/frontend test -- --run`
5. `pnpm --filter @aichat/frontend type-check`
6. `pnpm --filter @aichat/mobile type-check`
7. `pnpm architecture:check`
8. Run `code-review` skill against `main...HEAD`
9. Fix all actionable findings and re-run verification
10. Use `finishing-a-development-branch`: merge to `main`, run tests on merged result, push `origin/main`, delete feature branch
