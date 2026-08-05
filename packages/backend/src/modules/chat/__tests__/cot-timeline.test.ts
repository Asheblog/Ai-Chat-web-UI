import {
  buildInterleavedCotNodes,
  buildToolStepTitle,
  countCotTimelineTools,
  resolveToolDisplay,
} from '@aichat/shared/cot-timeline'
import type { ToolEvent } from '@aichat/shared/tool-events'

const baseEvent = (override: Partial<ToolEvent> & Pick<ToolEvent, 'id' | 'tool'>): ToolEvent => ({
  sessionId: 1,
  messageId: 1,
  stage: 'result',
  status: 'success',
  createdAt: 1,
  ...override,
})

describe('buildInterleavedCotNodes', () => {
  test('按 offset 交错推理与工具', () => {
    const reasoning = 'AAAAABBBBBCCCCC'
    const events = [
      baseEvent({
        id: 't1',
        tool: 'web_search',
        callId: 'c1',
        createdAt: 10,
        details: { reasoningOffsetStart: 5 },
        query: '今日新闻',
      }),
      baseEvent({
        id: 't2',
        tool: 'read_url',
        callId: 'c2',
        createdAt: 11,
        details: { reasoningOffsetStart: 5 },
        query: 'https://example.com',
      }),
    ]

    const nodes = buildInterleavedCotNodes(reasoning, events)
    expect(nodes.map((node) => node.type)).toEqual(['reasoning', 'toolGroup', 'reasoning'])
    if (nodes[0].type === 'reasoning') {
      expect(nodes[0].text).toBe('AAAAA')
      expect(nodes[0].charStart).toBe(0)
      expect(nodes[0].charEnd).toBe(5)
    }
    if (nodes[1].type === 'toolGroup') {
      expect(nodes[1].toolType).toBe('web_search')
      expect(nodes[1].events).toHaveLength(2)
    }
    if (nodes[2].type === 'reasoning') {
      expect(nodes[2].text).toBe('BBBBBCCCCC')
    }
  })

  test('推理段展示时剥离工具进度污染', () => {
    const reasoning = ['plan step', '联网搜索：今日新闻', 'after'].join('\n')
    const nodes = buildInterleavedCotNodes(reasoning, [])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('reasoning')
    if (nodes[0].type === 'reasoning') {
      expect(nodes[0].text).toBe(['plan step', '', 'after'].join('\n').replace(/\n\n/g, '\n') || 'plan step\nafter')
      expect(nodes[0].text).not.toContain('联网搜索')
      expect(nodes[0].text).toContain('plan step')
      expect(nodes[0].text).toContain('after')
    }
  })

  test('无 offset 的工具挂到末尾 orphan', () => {
    const nodes = buildInterleavedCotNodes('thinking', [
      baseEvent({ id: 'orphan', tool: 'python_runner', callId: 'p1' }),
    ])
    expect(nodes.map((node) => node.type)).toEqual(['reasoning', 'tool'])
  })

  test('countCotTimelineTools 统计 active', () => {
    const nodes = buildInterleavedCotNodes('', [
      baseEvent({
        id: 'r1',
        tool: 'web_search',
        status: 'running',
        stage: 'start',
        callId: 'a',
      }),
      baseEvent({ id: 'r2', tool: 'python_runner', callId: 'b' }),
    ])
    expect(countCotTimelineTools(nodes)).toEqual({ totalToolCount: 2, activeToolCount: 1 })
  })
})

describe('resolveToolDisplay / buildToolStepTitle', () => {
  test('web_search 使用 globe 与查询标题', () => {
    expect(resolveToolDisplay('web_search')).toEqual({ label: '联网搜索', iconKey: 'globe' })
    expect(
      buildToolStepTitle(
        baseEvent({ id: '1', tool: 'web_search', query: '今日新闻 2026年8月5日' }),
      ),
    ).toBe('联网搜索：今日新闻 2026年8月5日')
  })

  test('get_time_info 映射时间信息', () => {
    expect(resolveToolDisplay('get_time_info')).toEqual({ label: '时间信息', iconKey: 'clock' })
  })
})
