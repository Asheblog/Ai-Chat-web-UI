# Single Model Multi-Question Battle UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the single-model multi-question battle page into a progressive “evaluation cockpit” that is easier for first-time users while keeping high-frequency workflows fast.

**Architecture:** Keep all existing battle data flow, API calls, session restore, sharing, history reuse, graph selection, and detail drawer behavior inside `SingleModelMultiQuestionPageClient`, but extract the UI into focused presentational components. Add a small pure helper module for dashboard metrics and history slicing so the new layout can be tested without coupling every test to async stream state.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui, Zustand, Vitest, Testing Library

---

## File Structure

- Create: `packages/frontend/src/features/battle/single-model/types.ts`
  Responsibility: shared page-local types such as `QuestionDraft` and status aliases used by extracted components.
- Create: `packages/frontend/src/features/battle/single-model/single-model-dashboard.ts`
  Responsibility: pure helpers for overview metrics, monitor counts, history slicing, and question card labels.
- Create: `packages/frontend/src/features/battle/single-model/single-model-dashboard.test.ts`
  Responsibility: verify helper logic before UI wiring.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleHero.tsx`
  Responsibility: top hero, actions, share feedback, source-run banner.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleOverview.tsx`
  Responsibility: four overview cards below the hero.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleConfigPanel.tsx`
  Responsibility: model selection and execution parameters.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelQuestionWorkspace.tsx`
  Responsibility: question card list, add/remove actions, question editing UI.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleMonitorPanel.tsx`
  Responsibility: running summary, progress, empty/running/error states.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleResultsPanel.tsx`
  Responsibility: result summary wrapper around `QuestionTrajectoryGraph`.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleHistoryPanel.tsx`
  Responsibility: recent history list, expand/collapse, refresh, reuse/view actions.
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx`
  Responsibility: verify recent-history default limit and expand flow.
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelMultiQuestionPageClient.tsx`
  Responsibility: keep all stateful orchestration, switch JSX to new cockpit layout, wire extracted components.
- Modify: `packages/frontend/src/features/battle/battle.css`
  Responsibility: only if a small shared class is needed for the new layout; prefer Tailwind first.

### Task 1: Add Pure Dashboard Helpers

**Files:**
- Create: `packages/frontend/src/features/battle/single-model/types.ts`
- Create: `packages/frontend/src/features/battle/single-model/single-model-dashboard.ts`
- Test: `packages/frontend/src/features/battle/single-model/single-model-dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildMonitorStats, getVisibleHistoryItems } from './single-model-dashboard'

describe('single-model dashboard helpers', () => {
  it('returns only the latest three history items when collapsed', () => {
    const history = [
      { id: 4 },
      { id: 3 },
      { id: 2 },
      { id: 1 },
    ] as any

    expect(getVisibleHistoryItems(history, false).map((item) => item.id)).toEqual([4, 3, 2])
    expect(getVisibleHistoryItems(history, true).map((item) => item.id)).toEqual([4, 3, 2, 1])
  })

  it('builds monitor counts from question attempt statuses', () => {
    const questions = [
      {
        questionIndex: 1,
        title: 'Q1',
        passCount: 1,
        passK: 1,
        runsPerQuestion: 2,
        passed: true,
        attempts: [
          { attemptIndex: 1, status: 'done', passed: true },
          { attemptIndex: 2, status: 'running', passed: false },
        ],
      },
      {
        questionIndex: 2,
        title: 'Q2',
        passCount: 0,
        passK: 1,
        runsPerQuestion: 1,
        passed: false,
        attempts: [
          { attemptIndex: 1, status: 'pending', passed: false },
        ],
      },
    ] as any

    expect(buildMonitorStats(questions, 'running')).toMatchObject({
      totalAttempts: 3,
      completedAttempts: 1,
      activeAttempts: 1,
      pendingAttempts: 1,
      passedQuestions: 1,
      failedQuestions: 1,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/single-model-dashboard.test.ts`
Expected: FAIL with module-not-found or missing export errors for `single-model-dashboard`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { BattleRunSummary } from '@/types'
import type { SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'

export function getVisibleHistoryItems(history: BattleRunSummary[], expanded: boolean, limit = 3) {
  return expanded ? history : history.slice(0, limit)
}

export function buildMonitorStats(
  questions: SingleQuestionTrajectoryView[],
  runStatus: 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled',
) {
  let completedAttempts = 0
  let activeAttempts = 0
  let pendingAttempts = 0

  for (const question of questions) {
    for (const attempt of question.attempts) {
      if (attempt.status === 'pending') pendingAttempts += 1
      else if (attempt.status === 'running' || attempt.status === 'judging') activeAttempts += 1
      else completedAttempts += 1
    }
  }

  const totalAttempts = completedAttempts + activeAttempts + pendingAttempts
  const passedQuestions = questions.filter((item) => item.passed).length

  return {
    runStatus,
    totalAttempts,
    completedAttempts,
    activeAttempts,
    pendingAttempts,
    passedQuestions,
    failedQuestions: Math.max(0, questions.length - passedQuestions),
    progressPercent: totalAttempts === 0 ? 0 : (completedAttempts / totalAttempts) * 100,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/single-model-dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit policy checkpoint**

Do not commit in this session unless the human explicitly asks for a commit.

### Task 2: Build and Test Recent History Panel

**Files:**
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleHistoryPanel.tsx`
- Test: `packages/frontend/src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SingleModelBattleHistoryPanel } from './SingleModelBattleHistoryPanel'

const items = [4, 3, 2, 1].map((id) => ({
  id,
  title: `任务 #${id}`,
  createdAt: '2026-04-01T00:00:00.000Z',
  status: id % 2 === 0 ? 'completed' : 'running',
  mode: 'single_model_multi_question',
  prompt: { text: '', images: [] },
  expectedAnswer: { text: '', images: [] },
  judgeModelId: 'judge',
  judgeThreshold: 0.8,
  runsPerModel: 1,
  passK: 1,
  updatedAt: '2026-04-01T00:00:00.000Z',
  summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: 0.8, passModelCount: 0, accuracy: 0, modelStats: [] },
})) as any

describe('SingleModelBattleHistoryPanel', () => {
  it('shows only three items until expanded', () => {
    render(
      <SingleModelBattleHistoryPanel
        history={items}
        expanded={false}
        onToggleExpanded={vi.fn()}
        onRefresh={vi.fn()}
        onViewRun={vi.fn()}
        onReuseRun={vi.fn()}
        historyLoading={false}
        historyLoadingRunId={null}
        isRunning={false}
      />,
    )

    expect(screen.getByText('任务 #4')).toBeInTheDocument()
    expect(screen.getByText('任务 #3')).toBeInTheDocument()
    expect(screen.getByText('任务 #2')).toBeInTheDocument()
    expect(screen.queryByText('任务 #1')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx`
Expected: FAIL with module-not-found for `SingleModelBattleHistoryPanel`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { History, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import type { BattleRunSummary } from '@/types'
import { getVisibleHistoryItems } from './single-model-dashboard'

interface SingleModelBattleHistoryPanelProps {
  history: BattleRunSummary[]
  expanded: boolean
  historyLoading: boolean
  historyLoadingRunId: number | null
  isRunning: boolean
  onToggleExpanded: () => void
  onRefresh: () => void
  onViewRun: (runId: number) => void
  onReuseRun: (runId: number) => void
}

export function SingleModelBattleHistoryPanel(props: SingleModelBattleHistoryPanelProps) {
  const visible = getVisibleHistoryItems(props.history, props.expanded)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" />最近历史</CardTitle>
        <CardDescription>默认仅展示最近 3 条，可展开全部历史</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.historyLoading || props.isRunning}>
          <RefreshCw className="mr-2 h-4 w-4" />刷新
        </Button>
        {visible.map((item) => (
          <div key={item.id} className="rounded-lg border border-border/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{item.title || `任务 #${item.id}`}</div>
                <div className="text-xs text-muted-foreground">#{item.id} · {formatDate(item.createdAt)}</div>
              </div>
              <Badge variant={item.status === 'completed' ? 'default' : 'secondary'}>{item.status}</Badge>
            </div>
          </div>
        ))}
        {props.history.length > 3 ? (
          <Button variant="ghost" onClick={props.onToggleExpanded}>{props.expanded ? '收起历史' : '展开全部历史'}</Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit policy checkpoint**

Do not commit in this session unless the human explicitly asks for a commit.

### Task 3: Extract Cockpit Layout Panels

**Files:**
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleHero.tsx`
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleOverview.tsx`
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleConfigPanel.tsx`
- Create: `packages/frontend/src/features/battle/single-model/SingleModelQuestionWorkspace.tsx`
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleMonitorPanel.tsx`
- Create: `packages/frontend/src/features/battle/single-model/SingleModelBattleResultsPanel.tsx`
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelMultiQuestionPageClient.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SingleModelBattleResultsPanel } from './SingleModelBattleResultsPanel'

describe('SingleModelBattleResultsPanel', () => {
  it('shows empty-state guidance before the first run', () => {
    render(
      <SingleModelBattleResultsPanel
        runId={null}
        isRunning={false}
        summary={null}
        computedStability={0}
        questionViews={[]}
        selectedNodeKey={null}
        onNodeClick={() => {}}
      />,
    )

    expect(screen.getByText('运行结果将在这里出现')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/SingleModelBattleResultsPanel.test.tsx`
Expected: FAIL with module-not-found for `SingleModelBattleResultsPanel`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { BattleRunSummary } from '@/types'
import { QuestionTrajectoryGraph, type SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'

interface SingleModelBattleResultsPanelProps {
  runId: number | null
  isRunning: boolean
  summary: BattleRunSummary['summary'] | null
  computedStability: number
  questionViews: SingleQuestionTrajectoryView[]
  selectedNodeKey: string | null
  onNodeClick: (questionIndex: number, attemptIndex: number) => void
}

export function SingleModelBattleResultsPanel(props: SingleModelBattleResultsPanelProps) {
  const stability = props.summary?.stabilityScore ?? props.computedStability
  return (
    <Card className="border-slate-800/70 bg-slate-950 text-slate-50">
      <CardHeader>
        <CardTitle>问题轨迹与结果</CardTitle>
        <CardDescription className="text-slate-300">稳定性 {(stability * 100).toFixed(1)}%</CardDescription>
      </CardHeader>
      <CardContent>
        {props.runId == null && props.questionViews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-6 text-sm text-slate-300">
            运行结果将在这里出现。先选择模型并填写至少一道题目，然后点击“开始评测”。
          </div>
        ) : (
          <QuestionTrajectoryGraph
            questions={props.questionViews}
            selectedNodeKey={props.selectedNodeKey}
            onNodeClick={props.onNodeClick}
            isRunning={props.isRunning}
          />
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Integrate the extracted panels into the page client**

Replace the page return tree so it renders:

```tsx
<div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-6 xl:px-8">
  <SingleModelBattleHero ... />
  <SingleModelBattleOverview ... />
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
    <div className="space-y-6">
      <SingleModelBattleConfigPanel ... />
      <SingleModelQuestionWorkspace ... />
      <SingleModelBattleHistoryPanel ... />
    </div>
    <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
      <SingleModelBattleMonitorPanel ... />
      <SingleModelBattleResultsPanel ... />
    </div>
  </div>
  <DetailDrawer ... />
</div>
```

- [ ] **Step 5: Run focused tests to verify it passes**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/single-model/single-model-dashboard.test.ts src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx src/features/battle/single-model/SingleModelBattleResultsPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit policy checkpoint**

Do not commit in this session unless the human explicitly asks for a commit.

### Task 4: Final Integration Verification

**Files:**
- Modify: `packages/frontend/src/features/battle/single-model/SingleModelMultiQuestionPageClient.tsx`
- Modify: extracted component files from Tasks 2-3 as needed

- [ ] **Step 1: Verify TypeScript build**

Run: `pnpm --filter @aichat/frontend type-check`
Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Verify targeted battle tests**

Run: `pnpm --filter @aichat/frontend exec vitest run src/features/battle/ui/PromptStep.sync.test.tsx src/features/battle/single-model/single-model-dashboard.test.ts src/features/battle/single-model/SingleModelBattleHistoryPanel.test.tsx src/features/battle/single-model/SingleModelBattleResultsPanel.test.tsx`
Expected: PASS

- [ ] **Step 3: Verify production build**

Run: `pnpm --filter @aichat/frontend build`
Expected: PASS with a successful Next.js production build.

- [ ] **Step 4: Commit policy checkpoint**

Do not commit in this session unless the human explicitly asks for a commit.

## Self-Review

- Spec coverage: Tasks 1-3 cover hero, overview cards, progressive config/workspace/monitor/results/history layout, and Task 4 covers final verification.
- Placeholder scan: no `TODO`, `TBD`, or deferred implementation language remains in the plan.
- Type consistency: extracted helpers and panels all depend on existing `BattleRunSummary`, `BattleResult`, `ModelItem`, and `SingleQuestionTrajectoryView` types rather than inventing parallel shapes.
