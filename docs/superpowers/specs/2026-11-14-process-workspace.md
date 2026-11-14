# Process workspace specification

Approved 2026-11-14. This is the implementation contract for the Web redesign, replacing the old CoT timeline. Original design review used Figma file `mqPJdKkA6O1Krf1ULsWRwz` and nodes `5:1978`, `2:81`, `3:1355`, `3:1508`, `6:3264`; the implementation decisions here and ADR-0044 take precedence over obsolete prototype-only controls.

## Reading hierarchy

1. Keep the final answer first. Follow it with a compact process entry and retain artifact download access.
2. Open process, sources and artifacts in one message-scoped workspace. Keep model-visible reasoning separate from tool records.
3. Use a 440px sidebar at widths ≥1440px, an overlay at 768–1439px, and a full-screen panel below 768px. Closing restores focus and reading context; the reading outline returns when the workspace closes.
4. Battle output details use a collapsed inline process panel, not a second modal. Public shares and Battle are read-only consumers of the same operation projection.

## Tool records and coverage

- Explicit event id identifies an operation; shared callId does not merge distinct event ids. Attach parentCallId only to a unique parent candidate. Show missing/ambiguous ancestry separately.
- Preserve running, success, error, pending, rejected and aborted states. Keep recovery/degradation separate from terminal result. Do not guess retry counts without actual evidence.
- Count unique records, parent calls, subtasks, affected parent calls and lifecycle updates with distinct units. Never subtract incompatible counts to infer a success rate.
- Keep trace, persisted and projection coverage separate, each complete/partial/unknown. Missing metadata means unknown, not zero or complete. Count dropped records separately from trimmed fields.
- Storage trimming uses `storageTruncated`; a tool runtime can report `truncated`. Storage loss changes coverage, not execution outcome. Historical list projections fetch full message details on demand.
- A source list deduplicates URLs. Its order is not a Markdown citation number. Sources link to originals; no inactive citation-locate API or UI is exposed.

## Controls

- Stop subsequent tools keeps the current connection and in-flight work, prevents later tools and permits at most one tool-free final-answer request. An accepted acknowledgement does not itself mean completion.
- Whole-run cancellation remains distinct and wins a stop/cancel race. Preserve existing answer text when the final answer was not generated.
- Persist stopReason/finalAnswerGenerated through execution events, SSE, hydration, snapshots, history and shares. Do not invent terminal metadata when a producer lacks it.
- Reuse actual research-plan approval actions. Adjust requires nonempty feedback and preserves input on request failure; submission disables duplicates. Reissue fills the original question for editing rather than auto-sending.
- Label whole-round regeneration accurately. No generic single-tool retry, generic approval engine or fictitious local command is added.

## Interaction and scale

- Preserve existing message-scoped disclosure preferences. A new message/run/model/attempt does not inherit another process view’s transient filters or ledger state.
- Search and filter current-message records. Retain necessary ancestor rows as labeled context without counting them as matched operations. A failed parent must not reveal unrelated successful children as failure matches.
- Support keyboard focus, Escape close, tab arrow navigation, visible controls, narrow screens, long Chinese text and raw JSON. Live updates must not steal focus.
- Trace97 has ten retained anonymized metadata records, not a recovered full 454-record event log. The separate 454-record pressure fixture is explicitly synthetic.

## Migration and acceptance

Direct replacement of the old Web presentation. Read historical toolLogsJson arrays because user data already exists, but retain no second UI. Write v2 envelopes without a new database column. Remove the old no-effect `/api/chat/stop`; retain real whole-run cancel.

Acceptance combines project tests/type checks/builds, independent Standards+Spec review, and real dev-browser screenshots for chat/share/Battle at desktop, breakpoint and phone widths in light/dark themes. Read-only actor/branding mocks used for browser component acceptance are identified as mocks, not a live authenticated backend end-to-end run.
