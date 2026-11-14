# Process workspace delivery

## Implemented surface

The Web message layout is compact process entry → answer, with the optional workspace opened from that entry. The workspace separates process, sources, artifacts and a searchable call ledger. Desktop uses a 440px sidebar from 1440px; 768–1439px uses an overlay; narrower screens use a full-screen panel. Battle renders its read-only process inline inside the output detail dialog, collapsed initially.

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

## Message-layout follow-up

The chat waiting indicator now follows the compact process entry and includes a loading icon. It disappears when text, a rich payload or a generated image can be displayed; unusable image metadata keeps the waiting feedback visible. Reduced-motion preferences stop the icon animation, and process activity remains the only live announcement in the message.

User avatars are omitted from message bubbles while top-bar identity and assistant avatars remain. User bubbles are capped at the smaller of 520px and their chat column. Copy, edit and share actions retain their existing entry points. Layout regression coverage includes waiting order, text arrival, stream completion, image-only and rich answers, invalid image metadata, and message actions. The final focused run passed 12 tests across three files. The complete final frontend run passed 159 files / 951 tests. Frontend type checking passed after removing the temporary preview route and its stale generated Next type.

Real-browser acceptance verified 1600px and 385px views with a closed or open navigation sidebar, plus light and dark themes. The long user bubble measured 520px in a 1328px chat column and 345px in a 345px column; page horizontal overflow was zero. The loading icon appeared below the summary with a 12px gap, disappeared after answer content arrived, and did not add a second live region. Top-bar user identity remained, message user avatars were absent, and assistant avatars remained. Browser console and page errors were zero. Actor and branding reads used the same read-only mocks as the original component acceptance. Final key captures are `output/playwright/process-workspace-layout-check-1600-light.png` and `output/playwright/process-workspace-layout-check-385-closed-light.png`. The temporary message-layout-check route was removed after acceptance.

The follow-up reading-order pass places the process entry before the answer body. The process panel and call ledger keep actionable list-projection and explicit runtime-gap notices, while removing persistence-loss and missing-snapshot banners. The reasoning tab now uses a locally extracted content title of at most 30 Unicode code points, including an ellipsis, per segment and expands to the original segment text on click. Short segments may use the whole sentence. Code-only segments use their first nonempty code line; content-free segments use a numbered placeholder. Disclosure preferences remain keyed by message scope and original segment offset. Collapsed buttons omit aria-controls; expanded buttons reference the mounted original-text panel.

The follow-up regression passed 10 affected files / 83 tests. A subsequent full frontend run passed 160 of 161 files and 963 tests; its sole failure was the newly added Unicode boundary regression, which exposed UTF-16/code-point indexing mixed during truncation. After repairing that bug and the code-title/accessibility review findings, the final process-workspace and consumer run passed 15 files / 164 tests, including 19 summary/disclosure tests. Earlier failed duplicate-text assertions were corrected to distinguish the visible title from the expanded body.

Final browser acceptance used the real MessageBubble at 1600×1000 and 385×844: process entry precedes completed answers, waiting feedback follows the entry, and content arrival removes waiting feedback. Four distinct title lengths measured 27/27/22/19 code points; expansion showed the complete original paragraph and a valid aria-controls target. Both removed banners stayed absent with trace unknown and persisted partial in the fixture. User bubbles measured 520px and 345px; horizontal overflow, console errors and page errors were zero. Final screenshots include `output/playwright/process-polish-1600-light.png`, `output/playwright/process-polish-1600-expanded.png`, `output/playwright/process-polish-385-light.png` and `output/playwright/process-polish-385-panel.png`. An initial fixture-only progress request returned 500 because its synthetic message did not exist; the final fixture uses complete projection and a read-only response mock, and the replacement captures contain no failed requests. The temporary acceptance route and its stale generated Next type were removed. Frontend type checking passed on the final reviewed candidate after restoring the generated Next environment file.

## Migration

Direct UI replacement; no database-column migration. Existing `toolLogsJson` values remain readable. No API compatibility wrapper is kept for the removed no-effect `/api/chat/stop` route. The existing cancel route remains the whole-run cancel entry point.
