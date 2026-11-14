# UI v2 browser acceptance fixtures

This harness runs the real Next.js UI against explicitly synthetic browser API fixtures. It does not start/stop the frontend or backend, install packages, download a browser, or send model-generation requests. Unknown APIs return `501 UI_FIXTURE_UNHANDLED_API` and become report gaps. External HTTP(S) resources are blocked.

## Run from repository root

Use an existing Node executable in PowerShell 7. The bundled Node path below is specific to this workstation; substitute your installed Node elsewhere.

```powershell
$node = "C:/Users/wanglinyu/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
& $node scripts/ui-acceptance/self-check.cjs
& $node scripts/ui-acceptance/run.cjs --list
& $node scripts/ui-acceptance/run.cjs --scenarios all --widths 1440,390,320 --themes light,dark --phase final-v2 --out final-v2
```

The runner resolves installed `playwright-core` packages under `node_modules/.pnpm` and chooses an existing Chromium matching that package revision. `PLAYWRIGHT_BROWSERS_PATH` is respected; `UI_ACCEPTANCE_CHROMIUM` explicitly selects an existing executable. No `npx` or dependency changes are used.

Options: `--base http://localhost:3000`, comma-separated `--scenarios`/`--widths`/`--themes`, `--phase`, `--out`, and optional `--headed`. Focused follow-ups use `--geometry-only` (no selector interaction replay), `--security-only` (personal security form only), or `--system-leaves logs-audit` (comma-separated system leaf keys). Optional width 358 is available for personal/logs boundary checks. Output is confined to `output/playwright/ui-v2/`. Keep pre-redesign baseline, early implementation and final acceptance in distinct directories. The full matrix includes three widths; dark mode is applied to the key pages listed in the manifest.

Each run saves a viewport screenshot for every interaction milestone, JSON with API/check/geometry/console/network evidence, a Markdown summary and an HTML image index. Exit `0`: no recorded issue; `1`: failed check, geometry finding, API gap, unexpected console/network error; `2`: runner/setup failure. Intentionally injected 503 responses are retained as `expected:true`. A screenshot alone is not visual acceptance: inspect representative desktop/mobile/dark and failure-state images.

## Source-grounded fixture coverage

- Login/registration use a fixture actor. Admin and ordinary-user personal settings are separate actors; personal navigation covers all four sections, system navigation all ten registry leaves.
- Models have cross-connection duplicate raw IDs, long Chinese names, vision/image capabilities and context limits. Search, no-results, separate favorite, keyboard selection, Escape/focus return and mobile close are exercised. Error/empty/loading/refresh-stale variants are separate scenarios.
- Existing session messages include Chinese Markdown/code/table, a long URL and successful/failed tool events. Composer text is filled but never sent.
- Battle configuration/question steps and a completed synthetic run/result use the actual battle DTOs; no battle stream is started.
- Logs include populated Chinese messages, nested `ctx`, long tag/URL, first-load failure and refresh failure preserving stale data. Trace uses a fixture detail/event list.
- Public share success/error are read-only. Synthetic SSR data requires the local fixture server described below.

Readiness includes the real content anchor of every dynamic system leaf, disappearance of its module-loading fallback, the real expanded security password fields, and—on public share—the rendered Markdown heading/code/table with no pending or raw-source fallback. Refresh-failure injection is explicitly armed by the test action rather than inferred from development-mode request counts. Empty/error catalog recovery switches the synthetic resolver back to the populated catalog immediately before the UI refresh action.

Fixture modules deliberately contain no real credentials or production data. Empty collections are only used for source-confirmed optional catalogs/metadata. Unmapped endpoints remain explicit gaps, never generic `{}` fallbacks. Tests check rendering/interactions with these DTOs, not real backend persistence, auth security or model answer quality.

## Public share SSR setup — service owner only

Browser interception does not affect `lib/server-share.ts` server fetches. Before starting the existing dev service, configure its already-supported backend environment and separately run the localhost-only responder:

```powershell
$env:BACKEND_HOST = "127.0.0.1"
$env:BACKEND_INTERNAL_PORT = "18001"
# When NEXT_PUBLIC_API_URL is already absolute it takes priority:
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:18001/api"
& $node scripts/ui-acceptance/share-server.cjs
```

The responder binds only `127.0.0.1:18001`. Only GET `/api/shares/ui-v2-demo` and `/api/shares/ui-v2-demo/messages` succeed, with query pagination and `includeMessages=0` support. Other routes/methods return 404. It is a test process, not a production route or flag. Start/stop/restart decisions stay with the frontend/service owner.

The pre-redesign report is evidence of the old implementation, not a final v2 verdict. Final acceptance must use the owner-confirmed implementation and restarted SSR configuration.
