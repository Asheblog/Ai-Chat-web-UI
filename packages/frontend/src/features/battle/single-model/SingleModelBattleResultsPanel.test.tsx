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
