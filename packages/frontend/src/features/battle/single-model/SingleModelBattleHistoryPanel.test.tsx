import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SingleModelBattleHistoryPanel } from './SingleModelBattleHistoryPanel'

const items = [4, 3, 2, 1].map((id) => ({
  id,
  title: `任务 #${id}`,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  status: id % 2 === 0 ? 'completed' : 'running',
  mode: 'single_model_multi_question',
  prompt: { text: '', images: [] },
  expectedAnswer: { text: '', images: [] },
  judgeModelId: 'judge',
  judgeThreshold: 0.8,
  runsPerModel: 1,
  passK: 1,
  summary: {
    totalModels: 1,
    runsPerModel: 1,
    passK: 1,
    judgeThreshold: 0.8,
    passModelCount: 0,
    accuracy: 0,
    modelStats: [],
  },
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
