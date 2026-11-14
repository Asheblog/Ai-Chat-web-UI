import { describe, expect, it } from 'vitest'
import { PREVIEW_CASES } from '../preview-cases'
import { DEV_ARTIFACT_FILES } from '../fixtures/primitives'
import {
  buildProcessIndex,
  buildProcessSummary,
  normalizeProcessCoverage,
} from '@/features/chat/process-workspace/model/process-model'
import { resolveProcessScope, resolveRunTerminal } from '@/features/chat/process-workspace/model/scope'
import type { PreviewCaseId } from '../preview-cases'

/**
 * 夹具契约（二）：各状态的结构计数、来源/产物、命令能力与只读边界。
 * 覆盖 completed / 同 id 合并 / running / failure / approval / empty / share / battle。
 */

const indexOf = (id: PreviewCaseId) => {
  const entry = PREVIEW_CASES[id]
  return buildProcessIndex({ events: entry.entryProps.toolEvents, coverage: entry.entryProps.coverage })
}

describe('completed：结构计数与来源/产物', () => {
  it('4 个父调用 + 8 个子任务 = 12 条记录', () => {
    const summary = buildProcessSummary(indexOf('completed'))
    expect(summary.totalOperations).toBe(12)
    expect(summary.parentCalls).toBe(4)
    expect(summary.subtasks).toBe(8)
    expect(summary.failedOperations).toBe(0)
    expect(summary.affectedParentCalls).toBe(0)
  })

  it('引用命中去重后给出真实来源，长中文正文不截断', () => {
    const { toolEvents, content, artifacts, meta } = PREVIEW_CASES.completed.entryProps
    const hits = toolEvents.flatMap(event => event.hits ?? [])
    expect(hits.length).toBe(18)
    expect(new Set(hits.map(hit => hit.url)).size).toBe(12)
    expect((content ?? '').length).toBeGreaterThan(800)
    expect(content ?? '').toContain('政策与民生')
    expect(meta.artifacts?.length).toBe(artifacts?.length)
    expect(artifacts?.map(artifact => artifact.fileName)).toEqual(
      DEV_ARTIFACT_FILES.map(file => file.fileName),
    )
    for (const artifact of artifacts ?? []) {
      expect(artifact.downloadUrl.startsWith('/dev/process-workspace-preview/artifacts/')).toBe(true)
      expect(DEV_ARTIFACT_FILES.some(file => artifact.downloadUrl.endsWith(file.slug))).toBe(true)
    }
    expect(resolveRunTerminal(meta).finalAnswerGenerated).toBe(true)
  })
})

describe('同 id 合并保留命中（来源面板依赖）', () => {
  it('start 无 hits + result 带 hits 合并后仍能列出 6 个来源', () => {
    const index = buildProcessIndex({ events: PREVIEW_CASES.completed.entryProps.toolEvents })
    const merged = index.records.find(record => record.id === 'call_zh_search:search:tavily')
    expect(merged).toBeDefined()
    expect(merged?.status).toBe('success')
    expect(merged?.duplicateCount).toBe(1)
    expect(merged?.event.hits?.map(hit => hit.url)).toHaveLength(6)
  })

  it('分享夹具同样保留 5 个来源，只读不影响来源面板', () => {
    const index = buildProcessIndex({ events: PREVIEW_CASES.share.entryProps.toolEvents })
    const merged = index.records.find(record => record.id === 'call_share_search:search:initial')
    expect(merged?.event.hits).toHaveLength(5)
  })
})

describe('running：可控等待与停止工具', () => {
  it('有在途调用，命令夹具可派发并记录，不发真实请求', async () => {
    const entry = PREVIEW_CASES.running
    const summary = buildProcessSummary(indexOf('running'))
    expect(summary.inFlight).toBeGreaterThan(0)
    expect(entry.entryProps.isStreaming).toBe(true)
    const log: string[] = []
    const fixture = entry.entryProps.commands
    expect(fixture?.onStopTools).toBeTypeOf('function')
    expect(fixture?.onCancelRun).toBeTypeOf('function')
    const acceptance = await fixture?.onStopTools?.({
      sessionId: entry.entryProps.meta.sessionId,
      messageId: entry.entryProps.meta.id,
    })
    expect(acceptance).toMatchObject({ accepted: true })
    expect(String(acceptance && 'reason' in acceptance ? acceptance.reason : '')).toContain('夹具')
    log.push('stop-tools')
    expect(log).toHaveLength(1)
  })
})

describe('failure：失败、未获许可、中止与降级分开计数', () => {
  it('outcome 分布正确，受影响父调用按根去重', () => {
    const summary = buildProcessSummary(indexOf('failure'))
    expect(summary.failedOperations).toBe(1)
    expect(summary.rejected).toBe(1)
    expect(summary.aborted).toBe(1)
    expect(summary.degraded).toBe(1)
    // 搜索父调用有失败子任务；未获许可与中止是各自根调用本身 —— 三个根都受影响，各算 1 次
    expect(summary.affectedParentCalls).toBe(3)
    expect(summary.summaryText).toContain('未获许可 1 次')
  })

  it('覆盖缺口写明丢记录与裁字段，答案是降级而非失败', () => {
    const coverage = normalizeProcessCoverage(PREVIEW_CASES.failure.entryProps.coverage)
    expect(coverage.persisted.status).toBe('partial')
    expect(coverage.persisted.droppedRecords).toBe(6)
    expect(coverage.persisted.truncatedFields).toBe(12)
    expect(PREVIEW_CASES.failure.entryProps.artifacts).toBeUndefined()
    const terminal = resolveRunTerminal(PREVIEW_CASES.failure.entryProps.meta)
    expect(terminal.finalAnswerGenerated).toBe(true)
  })
})

describe('approval：只转发真实计划审批', () => {
  it('待批准调用是 in_flight，计划内容来自 details.plan', () => {
    const events = PREVIEW_CASES.approval.entryProps.toolEvents
    const planEvent = events.find(event => event.details?.plan)
    expect(planEvent).toBeDefined()
    expect(planEvent?.phase).toBe('pending_approval')
    expect(planEvent?.status).toBe('pending')
    expect(planEvent?.details?.plan?.sub_questions).toHaveLength(3)
    const summary = buildProcessSummary(indexOf('approval'))
    expect(summary.inFlight).toBe(1)
    expect(PREVIEW_CASES.approval.entryProps.commands?.onResearchPlanDecision).toBeTypeOf('function')
  })
})

describe('empty：无过程时不伪造占位', () => {
  it('零事件、空正文、空产物', () => {
    const entry = PREVIEW_CASES.empty
    expect(entry.entryProps.toolEvents).toHaveLength(0)
    expect(entry.entryProps.reasoningRaw).toBe('')
    expect(entry.entryProps.content).toBe('')
    expect(entry.entryProps.artifacts).toBeUndefined()
    expect(entry.isEmpty).toBe(true)
    expect(entry.provenance.kind).toBe('illustrative')
  })
})

describe('share / battle：只读且不可发命令', () => {
  it('分享作用域只读，Battle 以 sessionId 0 隔离聊天命令', () => {
    const share = PREVIEW_CASES.share.entryProps
    expect(share.readOnly).toBe(true)
    expect(share.commands).toBeUndefined()
    const shareScope = resolveProcessScope(share.meta, { readOnly: true })
    expect(shareScope.origin).toBe('share')
    expect(shareScope.canCommand).toBe(false)

    const battle = PREVIEW_CASES.battle.entryProps
    expect(battle.meta.sessionId).toBe(0)
    const battleScope = resolveProcessScope(battle.meta)
    expect(battleScope.origin).toBe('battle')
    expect(battleScope.readOnly).toBe(true)
    expect(battleScope.canCommand).toBe(false)
    expect(battle.commands).toBeUndefined()
  })

  it('分享仍保留树关系与覆盖提示，不因只读丢数据', () => {
    const summary = buildProcessSummary(indexOf('share'))
    expect(summary.parentCalls).toBeGreaterThan(0)
    expect(summary.subtasks).toBeGreaterThan(0)
    expect(normalizeProcessCoverage(PREVIEW_CASES.share.entryProps.coverage).persisted.status).toBe('unknown')
  })

  it('分享消息带真实产物与来源，只读面板仍可列出与下载', () => {
    const share = PREVIEW_CASES.share.entryProps
    expect(share.artifacts).toHaveLength(DEV_ARTIFACT_FILES.length)
    for (const artifact of share.artifacts ?? []) {
      expect(artifact.downloadUrl.startsWith('/dev/process-workspace-preview/artifacts/')).toBe(true)
    }
    const hits = share.toolEvents.flatMap(event => event.hits ?? [])
    expect(hits.length).toBeGreaterThanOrEqual(5)
  })
})
