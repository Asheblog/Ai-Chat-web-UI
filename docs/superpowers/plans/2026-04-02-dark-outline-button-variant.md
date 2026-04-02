# Dark Outline Button Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable dark-surface outline button variant so dark panels do not need ad-hoc text color overrides and do not regress into unreadable hover states.

**Architecture:** Extend the shared `Button` variant map with a dedicated inverse outline variant instead of changing the existing `outline` behavior globally. Migrate the single-model battle hero to the new variant first, keep the old variant untouched for light surfaces, and lock the behavior with both shared-component and feature-level tests.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, class-variance-authority, Vitest, Testing Library

---

## File Structure

- Create: `packages/frontend/src/components/ui/button.test.tsx`
  Responsibility: verify the new shared button variant emits dark-surface-safe classes.
- Modify: `packages/frontend/src/components/ui/button.tsx`
  Responsibility: add the reusable inverse outline variant.
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelBattleHero.tsx`
  Responsibility: switch dark hero action buttons to the shared variant and remove repeated color overrides.
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelBattleHero.test.tsx`
  Responsibility: keep the feature-level regression test aligned with the shared variant usage.

### Task 1: Add Shared Inverse Outline Variant

**Files:**
- Create: `packages/frontend/src/components/ui/button.test.tsx`
- Modify: `packages/frontend/src/components/ui/button.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { buttonVariants } from './button'

describe('buttonVariants', () => {
  it('supports inverse outline buttons for dark surfaces', () => {
    const classes = buttonVariants({ variant: 'outlineInverse' as never })

    expect(classes).toContain('bg-slate-950/30')
    expect(classes).toContain('text-slate-100')
    expect(classes).toContain('hover:text-slate-50')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichat/frontend exec vitest run src/components/ui/button.test.tsx`
Expected: FAIL because `outlineInverse` is not implemented yet

- [ ] **Step 3: Write minimal implementation**

```ts
outlineInverse:
  'border-slate-700 bg-slate-950/30 text-slate-100 hover:bg-slate-900 hover:text-slate-50',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aichat/frontend exec vitest run src/components/ui/button.test.tsx`
Expected: PASS

### Task 2: Migrate the Single-Model Hero

**Files:**
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelBattleHero.tsx`
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelBattleHero.test.tsx`

- [ ] **Step 1: Keep the feature regression test focused on readability**

```tsx
expect(screen.getByRole('button', { name: '新任务' })).toHaveClass('text-slate-100')
expect(screen.getByRole('button', { name: '新任务' })).toHaveClass('hover:text-slate-50')
```

- [ ] **Step 2: Replace ad-hoc dark outline classes with the shared variant**

```tsx
<Button variant="outlineInverse" onClick={onNewTask} disabled={isRunning} className="gap-2">
  <RefreshCw className="h-4 w-4" />新任务
</Button>
```

- [ ] **Step 3: Run feature tests**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/SingleModelBattleHero.test.tsx src/features/battle/single-model/useSingleModelBattleController.test.tsx src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx src/features/battle/single-model/SingleModelBattleResultsPanel.test.tsx`
Expected: PASS

### Task 3: Audit Nearby Dark-Surface Usage

**Files:**
- Inspect: `packages/frontend/src/features/battle/single-model/*.tsx`

- [ ] **Step 1: Search for dark panels still using ad-hoc `outline` overrides**

Run: `rg 'variant="outline"|bg-slate-950|text-slate-100' packages/frontend/src/features/battle/single-model`
Expected: confirm whether any additional dark action buttons need `outlineInverse`

- [ ] **Step 2: Keep scope minimal**

Only migrate components that are clearly dark-surface action buttons. Leave light-surface `outline` usage untouched.
