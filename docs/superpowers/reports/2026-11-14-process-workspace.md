# Process workspace delivery

## Implemented surface

The Web message layout is answer → compact process entry → optional workspace. The workspace separates process, sources, artifacts and a searchable call ledger. Desktop uses a 440px sidebar from 1440px; 768–1439px uses an overlay; narrower screens use a full-screen panel. Battle renders its read-only process inline inside the output detail dialog, collapsed initially.

The old CoT timeline, research-plan/tool cards, typewriter and their unused scroll helpers are removed rather than retained as a second presentation path. Message-scoped disclosure preferences remain supported. Sources are URL-deduplicated links; their list order is not a claim about Markdown citation identity. No inactive citation-locate command is exposed.

## Execution and data contract

- `POST /api/chat/stream/stop-tools` only accepts an actor-owned active run. It lets the in-flight tool finish, prevents later tools, and allows at most one tool-free final-answer request. Its acknowledgement is acceptance, not completion. Whole-run cancellation remains separate and takes priority.
- The run summary carries `stopReason` and `finalAnswerGenerated`. A false final-answer result is retained through SSE, message hydration, snapshots, history and public shares without inventing answer text.
- Tool records use explicit event identity. Parent relations are attached only when unique. Failed, rejected, aborted and degraded results retain distinct meaning; lifecycle updates are not counted as extra calls.
- The v2 log envelope uses separate trace, persisted and projection coverage. Record deletion and field trimming are counted separately. Old arrays remain readable with unknown coverage; old compaction markers become coverage gaps, never successful operations.
- Share, detail and Battle readers preserve supported hit fields. Write-side sanitization and progressive compression trim fields with loss accounting, including entire hit groups at the extreme layer; share projection does not additionally delete them. Storage trimming uses storageTruncated, separate from a tool runtime’s own truncated result.

## Verification record

Final backend suite: 172 suites / 1,080 tests passed. Mobile: 3 files / 8 tests passed. Shared build, frontend/backend/mobile type checks, architecture check and both Web/backend production builds passed. Final frontend suite: 158 files / 945 tests passed after synchronizing two stale text assertions. Production smoke checks returned HTTP 404 for both the dev preview page and its fixture artifact route.

The standalone global `pnpm lint:lines` gate remains failing for existing large modules and expanded hydration/host seams (including server-message.ts at 316 lines and snapshot-store.ts at 310); this is not reported as a passed lint gate. All new package files are at most 300 lines. Existing function-size, hook-dependency and image lint warnings are retained, with production compilation successful.

Real-browser component acceptance runs against the project dev server. Actor and branding reads are schema-correct read-only mocks; this evidence does not represent a live authenticated backend end-to-end session. Backend route and persistence tests cover the execution/data contracts. Trace97 uses ten retained anonymized metadata records; the 454-record stress dataset is synthetic and labeled accordingly. Screenshots and machine-readable acceptance outputs stay under local `output/playwright/`.

## Independent review disposition

Standards and Spec reviews ran from merge-base `026f1486605060e9598dcdff5f0efd903b071f49` against the working candidate. The blocking storage-trimming/degradation finding is fixed and independently reproduced across runtime, history and share projections. Battle coverage now uses unique-only matching instead of selecting the first ambiguous attempt.

Task-level review fixes include failure filtering, ancestor context in the ledger, disclosure preference recovery, per-message view-state reset, single-modal Battle details, truncation notices, tab focus/ARIA targets, and research-plan pending/failure handling. Reissue prefers the explicit parent question for regenerated branches. Duplicate parent-call copy, stale identity comments and missing HTTP error detail are corrected.

Recorded nonblocking follow-ups: centralize stop-reason literals/guards; unify the two equivalent terminal-event arbiters; deepen the boundary between call-ledger and process-workspace; consolidate remaining backend log-id parsing. These are maintainability tasks, not claims of completed refactoring. Existing large-file, hook-dependency and image lint warnings remain visible in build output.

## Migration

Direct UI replacement; no database-column migration. Existing `toolLogsJson` values remain readable. No API compatibility wrapper is kept for the removed no-effect `/api/chat/stop` route. The existing cancel route remains the whole-run cancel entry point.
