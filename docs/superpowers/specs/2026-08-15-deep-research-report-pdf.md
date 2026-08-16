# Deep Research Report with PDF Output — Spec

Date: 2026-08-15
Branch: feat/deep-research-pdf
Base: main

## Goal

Add a built-in **Deep Research** skill to AIChat chat. When the user enables the
skill and asks a research question, the assistant performs multi-step web
research, reads source pages, writes a cited Markdown report, and calls the new
`export_pdf` tool so the user receives a downloadable PDF artifact in the chat.

## Scope

### In scope

1. New built-in skill slug `deep-research` (display name: 深度研究).
2. Deep-research system prompt that enforces:
   - a short research plan before searching;
   - iterative `web_search` / `read_url` evidence collection;
   - a structured Markdown report with inline `[n]` citations;
   - a final `export_pdf` call for the full report.
3. New built-in tool `export_pdf`:
   - input: `title`, `markdown`, optional `filename`;
   - writes the report to the session workspace;
   - renders a styled A4 PDF with CJK fonts, page margins, and page numbers;
   - publishes PDF + Markdown as chat artifacts through the existing artifact
     download pipeline;
   - emits tool events and the existing `artifact` stream event.
4. PDF exporter:
   - `markdown-it` converts report Markdown to print-oriented HTML;
   - `playwright-core` + system Chromium renders `page.pdf()`;
   - deterministic HTML template with print CSS.
5. Production Docker: install CJK fonts (`fonts-noto-cjk`) so Chinese reports
   render correctly.
6. Frontend skill preset entry for `deep-research`.

### Out of scope (future work)

- Standalone long-running `/api/deep-research/runs` jobs.
- Dedicated `DeepResearchRun` database table.
- System settings page for research depth/source caps.
- Async background research queues.
- Charts, diagrams, cover pages, and generated TOC pages.
- Mobile-specific deep-research UI.

## Acceptance criteria

- Requesting `skills.builtin: ["deep-research"]` activates the agent tool path,
  even when web search is not separately requested.
- `export_pdf` is only registered when `deep-research` is requested.
- `export_pdf` returns artifact metadata and the artifacts are downloadable via
  the existing `/api/artifacts/:id/download` route.
- PDF bytes start with `%PDF`; the HTML template is valid and CJK-friendly.
- All backend and frontend tests and type-checks pass.
- `architecture:check` passes.
- Docker backend image installs the CJK fonts used by the PDF template.
