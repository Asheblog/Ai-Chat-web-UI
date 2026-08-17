# Deep Research Composer Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose a Deep Research toggle on the chat composer toolbar (desktop + mobile) and welcome flow so `skills.builtin` includes `deep-research` when enabled.

**Architecture:** Mirror the existing web-search / Python preference + `ComposerFeatureControls` chip pattern. Persist toggle in zustand; wire through feature flags → composer panel → send command / welcome send.

**Tech Stack:** React, Vitest, Testing Library, zustand persist, Lucide `Telescope`

---

### Task 1: Preference store + toolbar chip (TDD)

**Files:**
- Create: `packages/frontend/src/store/deep-research-preference-store.ts`
- Modify: `packages/frontend/src/components/chat/composer-toolbar-primitives.tsx`
- Test: `packages/frontend/src/components/chat/__tests__/composer-toolbar-primitives.test.tsx`

**Steps:** Failing test for「深度研究」button → add store + chip props/UI between 联网 and Python → pass → commit.

### Task 2: Feature flags + send payload (TDD)

**Files:**
- Modify: `packages/frontend/src/features/chat/composer/use-composer-feature-flags.ts`
- Modify: `packages/frontend/src/hooks/use-send-command.ts`
- Modify: `packages/frontend/src/hooks/use-chat-composer.ts`
- Test: `packages/frontend/src/hooks/__tests__/use-send-command.test.ts`

**Steps:** Failing test that enabled deep research adds `deep-research` to builtin skills → wire flags + send → pass → commit.

### Task 3: Wire desktop/mobile/welcome + docs

**Files:**
- Modify: composer panel, desktop/mobile composers, viewmodel, welcome VM/form/advanced options, skill panel count if needed
- Modify: `CONTEXT.md`
- Fix tests that need new required props

**Steps:** Wire props end-to-end → update CONTEXT → verify frontend tests → commit.
