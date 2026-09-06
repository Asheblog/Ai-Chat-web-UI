# Decoupling Regression Fixes

**Goal:** Restore live shares and release SSE resources on every exit, then remove
the agent runtime's reverse dependency on the chat feature.

**Architecture:** Finite producers complete when their work returns. Subscription
producers explicitly await closure. One idempotent close path owns heartbeat,
abort-listener and subscription cleanup. Agent runtime owns provider adapters and
planning helpers; request data and retry settings enter through explicit contracts.

**Tech Stack:** TypeScript, Hono Web Streams, Jest, pnpm, GitHub Actions.

## Acceptance

- Chat and Battle live shares deliver events after subscription initialization.
- Completion, abort, reader cancellation and initialization failure release all
  owned resources exactly once, including cleanup registered after closure.
- Finite Battle execution retains its existing completion and error events.
- Agent-runtime production imports do not reach modules/chat, directly or through
  the moved helpers; the architecture guard enforces this rule.
- Existing request validation, retry delays and provider payloads stay correct.
- Relevant tests and type checks pass; review precedes commit and main push.
- Observe the workflow for the pushed commit through image-build completion.

## Tasks

1. Add failing SSE unit and live-share route regressions. Run them against HEAD.
2. Implement explicit subscription lifetime and idempotent resource cleanup.
   Run new tests and the backend regression suite.
3. Add failing runtime-boundary/retry-injection tests. Move shared provider and
   planning logic to its owner, inject retry configuration, and replace the chat
   request-schema dependency with a runtime request contract. Migrate consumers
   directly and remove obsolete forwarding files touched by this change.
4. Update architecture documentation, run architecture guard and type checks,
   and perform independent specification and code-quality reviews.
5. Commit only this task's files, integrate into main, push, and inspect GitHub
   Actions for that exact commit. Fix any build failures within this scope.

## Migration

No data migration. Internal imports are replaced directly; SSE wire events and
public HTTP request validation retain their existing contracts.

## Verification

- SSE regressions failed before the fix (11 failed, 1 passed), then passed with
  cancellation, terminal events and late cleanup registration covered.
- Retry policy and container wiring tests failed before injection was added.
  Chat and Battle now share the configured requester.
- Backend: 127 suites, 674 tests passed. The Windows host required process-local
  `RUST_LOG=info` for Prisma migration tests; no application setting was changed.
- Frontend: 82 suites, 472 tests passed. Mobile: 3 suites, 8 tests passed.
- Backend, frontend, mobile and shared type checks passed; architecture guard passed.
- Final repository push and Linux image verification are performed after review.
