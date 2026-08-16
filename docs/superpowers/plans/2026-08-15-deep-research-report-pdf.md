# Deep Research Report with PDF Output — Implementation Plan

Date: 2026-08-15
Branch: feat/deep-research-pdf
Base: main

## Approach

Reuse the existing agent tool loop (`runToolOrchestration`) and the existing
`web_search` / `read_url` tools instead of building a parallel orchestrator.
A new built-in skill injects the deep-research workflow prompt, and a new
`export_pdf` tool converts the generated Markdown report into a downloadable
PDF artifact.

## Tasks

1. **PDF renderer**
   - Add `markdown-it` to the backend.
   - Create `services/reports/pdf-report-service.ts` with HTML template, Markdown
     rendering, and Chromium PDF generation.
   - Extend the local `playwright-core` type declaration for `setContent`/`pdf`.
   - Unit-test HTML escaping and PDF signature with an injected fake page.

2. **`export_pdf` tool**
   - Add `PdfExportHandlerConfig` to the tool handler types.
   - Implement `tool-handlers/export-pdf-handler.ts`.
   - Register it in `createToolHandlerRegistry`.
   - Unit-test validation, fallback artifacts, and publish wiring.

3. **Built-in skill wiring**
   - Add `deep-research` to `BUILTIN_SKILL_SLUGS` and `BUILTIN_SKILLS`.
   - Add the deep-research workflow prompt to `ChatRequestBuilder`.
   - Extend `computeAgentToolFlags` so deep research activates web search, URL
     reader, and PDF export.
   - Pass PDF export config through `AgentResponseParams` and the skill registry.
   - Update `isBuiltinSkill`.

4. **Frontend preset + Docker**
   - Add the deep-research preset in `features/skills/presets.ts`.
   - Add `fonts-noto-cjk` to the backend production Dockerfile.

5. **Validation**
   - Run architecture guard, backend/frontend tests, and type-checks.
   - Run code-review per task and a final review.
   - Merge to `main`, push to `origin`, and watch CI until green.
