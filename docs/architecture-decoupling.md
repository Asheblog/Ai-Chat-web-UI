# Architecture Decoupling

## Goals

AIChat is deployed as a lightweight modular monolith. Cross-cutting code is shared
inside the backend instead of being duplicated per route, and the frontend keeps
UI primitives separate from feature domains.

## Enforced rules

`pnpm architecture:check` runs `scripts/check-architecture.mjs` and fails on:

- import cycles in `backend`, `frontend`, `mobile`, or `shared` sources
- backend `api/*` files importing the `db` singleton directly
- backend `services/*` importing `modules/chat`, and `utils/*` importing feature modules
- backend `agent-runtime/*` importing `modules/chat`, including type imports
- service keys declared in `AppContainer` but never registered

## Backend composition

- `AppContainer` owns every singleton, including chat stream collaborators,
  image generation, skill installer/approval, MCP, and stream settings.
- `index.ts` only composes Hono routes from container services.
- Streaming configuration is normalized in `services/stream/stream-config-resolver.ts`.
- SSE keepalive settings are read by `services/stream/stream-settings-service.ts`.
- `http/sse.ts` owns the response lifetime and idempotent resource cleanup. Finite
  producers finish when their callback returns; subscription producers await
  explicit completion or disconnect. Abort and reader cancellation release the
  same resources as normal completion, without cancelling background Battle work.
- `agent-runtime` owns provider tool adapters, tool contracts, orchestration and
  task planning. Chat and Battle import this implementation directly; obsolete
  chat forwarding modules are removed.
- Request generation consumes `RequestGenerationOptions`, not the chat HTTP
  schema. Chat retains HTTP validation; settings/history loading lives in
  `services/chat/request-context.ts`.
- `AppContainer` injects retry delays into `ProviderRequester`; retry policy no
  longer depends on mutable chat globals.
- Chat reasoning protocol helpers live in
  `modules/chat/services/reasoning-protocol-utils.ts`.
- Battle value normalizers live in `services/battle/battle-utils.ts`.

## Frontend boundaries

- `components/ui` is the design system.
- Feature modules live in `features/*`.
- Shared composer and task-trace view-model types live beside their components
  in dedicated `*-types.ts` files to avoid render-tree import cycles.

## Migration

No data migration. Internal imports are directly replaced with their canonical
runtime/service paths. Public HTTP validation and SSE event payloads are unchanged.
