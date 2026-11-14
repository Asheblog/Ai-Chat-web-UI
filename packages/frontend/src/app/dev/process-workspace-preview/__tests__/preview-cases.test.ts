import { describe, expect, it } from 'vitest'
import trace97 from '../trace97.json'
import { PREVIEW_CASE_IDS, PREVIEW_CASES, resolvePreviewCase } from '../preview-cases'
import { TRACE97_DATASET } from '../fixtures/trace97-case'
import {
  buildProcessIndex,
  buildProcessSummary,
  normalizeProcessCoverage,
} from '@/features/chat/process-workspace/model/process-model'

/**
 * 夹具契约（一）：注册表、Trace97 回放口径、合成压力标注。
 * 页面可以改视觉，这三个口径不能漂：不补造 payload、不把 454/378 混成成功率、合成数据必须标注。
 */

const indexOf = (id: (typeof PREVIEW_CASE_IDS)[number]) => {
  const entry = PREVIEW_CASES[id]
  return buildProcessIndex({ events: entry.entryProps.toolEvents, coverage: entry.entryProps.coverage })
}

describe('案例注册表覆盖全部验收态', () => {
  it('九个案例齐全且 id 与顺序稳定', () => {
    expect(PREVIEW_CASE_IDS).toEqual([
      'completed',
      'running',
      'failure',
      'approval',
      'trace97',
      'stress',
      'empty',
      'share',
      'battle',
    ])
    for (const id of PREVIEW_CASE_IDS) {
      const entry = PREVIEW_CASES[id]
      expect(entry.id).toBe(id)
      expect(entry.label.trim().length).toBeGreaterThan(0)
      expect(entry.summary.trim().length).toBeGreaterThan(0)
      expect(entry.provenance.title.trim().length).toBeGreaterThan(0)
      expect(entry.provenance.detail.trim().length).toBeGreaterThan(0)
    }
  })

  it('未知 case 参数回到 completed，不抛错', () => {
    expect(resolvePreviewCase('nope').id).toBe('completed')
    expect(resolvePreviewCase(null).id).toBe('completed')
    expect(resolvePreviewCase('trace97').id).toBe('trace97')
  })

  it('每条事件的 sessionId/messageId 与 meta 一致，除压力夹具外 id 不重复', () => {
    for (const id of PREVIEW_CASE_IDS) {
      const { meta, toolEvents } = PREVIEW_CASES[id].entryProps
      const ids = toolEvents.map(event => event.id)
      // completed/share/stress 刻意带同 id 的 start+result 副本：唯一记录数按合并后口径断言
      const expectedUnique: Partial<Record<typeof id, number>> = { completed: 12, share: 3, stress: 454 }
      const unique = expectedUnique[id]
      if (unique !== undefined) {
        expect(new Set(ids).size).toBe(unique)
        expect(ids.length).toBeGreaterThan(unique)
      } else {
        expect(new Set(ids).size).toBe(ids.length)
      }
      for (const event of toolEvents) {
        expect(event.sessionId).toBe(meta.sessionId)
        expect(event.messageId).toBe(meta.id)
      }
    }
  })
})

describe('trace97：只回放导出保留的 10 条明细', () => {
  it('明细与 trace97.json 逐条一致，不补造 query/summary 之外的原始字段', () => {
    const events = PREVIEW_CASES.trace97.entryProps.toolEvents
    expect(events).toHaveLength(trace97.records.length)
    expect(events.map(event => event.id)).toEqual(trace97.records.map(record => record.id))
    trace97.records.forEach((record, position) => {
      const event = events[position]
      expect(event.tool).toBe(record.tool)
      expect(event.stage).toBe(record.stage)
      expect(event.status).toBe(record.status)
      expect(event.query).toBe(record.query)
      expect(event.summary).toBe(record.summary)
      expect(event.error).toBe(record.error)
      expect(event.createdAt).toBe(Date.parse(record.createdAt))
      // 导出没有 payload：不得凭空写结果正文、命中列表、尝试次数
      expect(event.resultText).toBeUndefined()
      expect(event.hits).toBeUndefined()
      expect(event.details?.attempts).toBeUndefined()
      expect(event.details?.resultJson).toBeUndefined()
    })
  })

  it('父子关系来自导出 id 的命名前缀，并用 details.parentCallId/callId 表达', () => {
    const events = PREVIEW_CASES.trace97.entryProps.toolEvents
    const parentOf = Object.fromEntries(
      events.map(event => [event.id, (event.details as { parentCallId?: string } | undefined)?.parentCallId ?? null]),
    )
    expect(parentOf).toEqual({
      call_jc0vlr6u: null,
      'call_jc0vlr6u:search:initial:1': 'call_jc0vlr6u',
      'call_jc0vlr6u:search:initial:2': 'call_jc0vlr6u',
      'call_dnfg5dox': null,
      'call_dnfg5dox:search:initial:1': 'call_dnfg5dox',
      'call_dnfg5dox:search:initial:2': 'call_dnfg5dox',
      'call_jc0vlr6u:read:1': 'call_jc0vlr6u',
      'call_jc0vlr6u:read:2': 'call_jc0vlr6u',
      'call_dnfg5dox:read:1': 'call_dnfg5dox',
      'call_dnfg5dox:read:2': 'call_dnfg5dox',
    })
  })

  it('台账口径：2 个父调用 + 8 个子任务，1 项降级影响 1 个父调用', () => {
    const index = indexOf('trace97')
    const summary = buildProcessSummary(index)
    expect(summary.totalOperations).toBe(10)
    expect(summary.parentCalls).toBe(2)
    expect(summary.subtasks).toBe(8)
    expect(summary.orphans).toBe(0)
    expect(summary.ambiguous).toBe(0)
    expect(summary.failedOperations).toBe(1)
    expect(summary.degraded).toBe(1)
    expect(summary.affectedParentCalls).toBe(1)
    expect(summary.attempts).toBeNull()
    expect(summary.summaryText).not.toContain('成功率')
  })

  it('454 / 378 / 10 三个口径分别标注，且不相互推算', () => {
    expect(TRACE97_DATASET.finalRecordCount).toBe(trace97.reportedFinalRecordCount)
    expect(TRACE97_DATASET.finalRecordCount).toBe(454)
    expect(TRACE97_DATASET.lifecycleUpdateCount).toBe(trace97.lifecycleUpdateCount)
    expect(TRACE97_DATASET.lifecycleUpdateCount).toBe(378)
    expect(TRACE97_DATASET.retainedDetailCount).toBe(10)
    expect(TRACE97_DATASET.turnEndedAt).toBe(Date.parse(trace97.endedAt))
    expect(TRACE97_DATASET.traceWindowEndedAt).toBe(Date.parse(trace97.traceWindowEndedAt))
    expect(TRACE97_DATASET.startedAt).toBe(Date.parse(trace97.startedAt))
    const facts = PREVIEW_CASES.trace97.provenance.facts ?? []
    expect(facts.map(fact => fact.label).join(' ')).toContain('454')
    expect(facts.map(fact => fact.label).join(' ')).toContain('378')
    expect(PREVIEW_CASES.trace97.provenance.kind).toBe('trace97-excerpt')
  })

  it('覆盖：链路窗口溢出为 partial 但缺口数量不虚构，持久化同样是 partial', () => {
    const coverage = normalizeProcessCoverage(PREVIEW_CASES.trace97.entryProps.coverage)
    expect(coverage.trace.status).toBe('partial')
    expect(coverage.trace.startedAt).toBe(Date.parse(trace97.startedAt))
    expect(coverage.trace.turnEndedAt).toBe(Date.parse(trace97.traceWindowEndedAt))
    expect(coverage.trace.droppedRecords).toBeUndefined()
    expect(coverage.persisted.status).toBe('partial')
    expect(coverage.projection.status).toBe('partial')
  })
})

describe('stress：454 条是合成压力数据，必须显式标注', () => {
  it('唯一记录数 454，raw 事件因重复副本多于 454', () => {
    const index = indexOf('stress')
    const summary = buildProcessSummary(index)
    expect(summary.totalOperations).toBe(454)
    expect(index.duplicateCount).toBeGreaterThan(0)
    expect(PREVIEW_CASES.stress.entryProps.toolEvents.length).toBeGreaterThan(454)
    expect(summary.parentCalls + summary.subtasks).toBe(454)
    expect(summary.failedOperations).toBeGreaterThan(0)
  })

  it('来源标注为合成，文案含"合成"，不与 trace97 混用', () => {
    expect(PREVIEW_CASES.stress.provenance.kind).toBe('synthesized')
    expect(PREVIEW_CASES.stress.provenance.title).toContain('合成')
    expect(PREVIEW_CASES.stress.provenance.detail).toContain('454')
    expect(PREVIEW_CASES.stress.provenance.detail).toContain('不是 Trace97')
  })
})
