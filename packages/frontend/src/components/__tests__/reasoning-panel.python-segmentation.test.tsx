import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ReasoningPanel } from '@/components/reasoning-panel'
import type { ToolEvent } from '@/types'

const extractThoughtTexts = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll(
      '.reasoning-activity-item:not(.reasoning-activity-item--tool) .reasoning-activity-item__description',
    ),
  )
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => text.length > 0)

const createPythonEvent = (
  stage: ToolEvent['stage'],
  status: ToolEvent['status'],
  reasoningOffsetStart: number,
  reasoningOffsetEnd?: number,
): ToolEvent => ({
  id: 'python-call-1',
  sessionId: 1,
  messageId: 'm-1',
  tool: 'python_runner',
  stage,
  status,
  summary: stage === 'result' ? 'stdout: 42' : 'print(6 * 7)',
  createdAt: 1000,
  details: {
    code: 'print(6 * 7)',
    reasoningOffsetStart,
    reasoningOffset: reasoningOffsetStart,
    reasoningOffsetEnd,
  },
})

describe('ReasoningPanel Python 分段回归', () => {
  it('Python start/result + reasoning 追加时，工具前分段不应串段', () => {
    const preTool = '先整理变量并校验输入。'
    const atTool = '\n执行 Python 代码并等待返回。'
    const postTool = '\n继续根据运行结果完善结论。'
    const appended = '\n补充最终答案并核对边界条件。'
    const reasoningV1 = `${preTool}${atTool}${postTool}`
    const reasoningV2 = `${reasoningV1}${appended}`
    const boundary = preTool.length

    const { container, rerender } = render(
      <ReasoningPanel
        status="streaming"
        durationSeconds={null}
        idleMs={null}
        expanded
        onToggle={() => {}}
        reasoningRaw={reasoningV1}
        reasoningHtml={undefined}
        reasoningPlayedLength={reasoningV1.length}
        isStreaming
        toolSummary={null}
        toolTimeline={[createPythonEvent('start', 'running', boundary)]}
      />,
    )

    const thoughtsBefore = extractThoughtTexts(container)
    expect(thoughtsBefore[0]).toBe(preTool)

    rerender(
      <ReasoningPanel
        status="streaming"
        durationSeconds={null}
        idleMs={null}
        expanded
        onToggle={() => {}}
        reasoningRaw={reasoningV2}
        reasoningHtml={undefined}
        reasoningPlayedLength={reasoningV2.length}
        isStreaming
        toolSummary={null}
        toolTimeline={[createPythonEvent('result', 'success', boundary, reasoningV1.length)]}
      />,
    )

    const thoughtsAfter = extractThoughtTexts(container)
    expect(thoughtsAfter[0]).toBe(preTool)
    expect(thoughtsAfter[0]).not.toContain('补充最终答案')
    expect(thoughtsAfter[1]).toContain('补充最终答案并核对边界条件。')
  })
})
