# Deep Research Plan Approval — Spec

Date: 2026-08-16
Branch: feat/deep-research-plan-approval
Base: main

## Goal

Require interactive user approval of the deep-research plan before any web
search or page reading starts. The plan is generated in the same streaming chat
turn, persisted through the existing `Message.toolLogsJson` pipeline, and can be
approved, adjusted (max 2 re-reviews), or cancelled.

## Scope

### In scope

1. Built-in `research_plan` tool, registered only when `deep-research` is
   requested, with the confirmed schema:
   `title`, `objective`, `sub_questions[] { question, keywords[] }`,
   `estimated_tool_rounds { min, max }`, fixed `deliverable`, optional `notes`.
2. Deep-research system prompt requires `research_plan` as the first tool call;
   non-plan tool calls are blocked with an error result until the plan is
   approved.
3. Plan approval card inline at the top of the CoT timeline (Web):
   - `开始研究` resumes the same reply
   - `调整计划` submits free-text feedback; model regenerates the plan and the
     user confirms again; at most 2 adjustment rounds, then only start/cancel
   - `取消` terminates the stream without another model call
4. No-search fallback: when deep-research is requested but no search engine is
   active, backend emits a synthetic `research_plan` choice card
   (`继续基于已有知识` / `取消`). Continuing answers directly and the final
   report is explicitly labelled as not web-verified. The deep-research prompt
   does not require `research_plan` on this path.
5. Approval wait timeout: 5 minutes. Timeout auto-expires the card and
   terminates the stream; it never auto-starts.
6. Persistence: pending/terminal plan cards are persisted as tool events in
   `Message.toolLogsJson`; no new DB table or migration. After refresh the card
   is static/read-only, expired cards offer `重新发起` (prefills composer).
7. Share page renders completed research plan cards statically/read-only. Live
   pending shares render "waiting" with no actions. Cancelled/expired
   deep-research messages are not shareable.
8. Web-only feature; mobile keeps protocol compatibility.

### Out of scope

- Plan resumption after disconnect or full checkpoint/resume runs.
- Auto-start switch or system setting.
- Per-field inline plan editing.
- Re-confirmation of plan deviations after approval.

## Acceptance criteria

- Requesting `skills.builtin: ["deep-research"]` registers `research_plan` and
  activates the approval flow when web search is active.
- Without web search, the no-search choice card appears before any model turn.
- `POST /api/chat/stream/research-plan/respond` accepts
  `decision: approve | adjust | cancel | continue`, is actor-scoped, and rejects
  stale/unknown approvals.
- Approved plan produces a tool result that lets the model continue in the same
  orchestrator loop; adjust regenerates and re-pauses; cancel/expiry emits a
  terminal `complete` chunk with `streamStatus: 'cancelled'` and persists the
  message status.
- Plan tool events carry the full plan in `details.plan`, with
  `status/phase` transitions: `pending/pending_approval` → `success/result`,
  `rejected/rejected`, or `aborted/aborted`.
- Web plan card renders all states, countdown, actions, and static history.
- Backend, frontend, and mobile tests/type-checks pass; `architecture:check`
  passes.
