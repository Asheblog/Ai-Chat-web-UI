/**
 * 压力夹具：120 个父调用 + 334 个子任务 = 454 条唯一记录，另有 200 条同 id 重复副本。
 *
 * 这是**合成数据**，只为验证树形渲染与滚动性能；它不是 Trace97 的明细，也不代表任何
 * 真实运行的成功率。页面横幅必须写明"合成"，数字只用本文件写下的常量。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { at, previewEvent, previewMeta } from './primitives'

export const STRESS_TOTAL_RECORDS = 454
export const STRESS_PARENT_COUNT = 120
export const STRESS_SUBTASK_COUNT = 334
export const STRESS_DUPLICATE_RECORDS = 200

const CHILD_COUNTS = Array.from({ length: STRESS_PARENT_COUNT }, (_, index) =>
  index < 94 ? 3 : 2,
)

const PARENT_FAILED = new Set([3, 17, 41, 66, 88, 104, 119])
const CHILD_FAILED = new Set([2, 19, 47, 88, 131, 201, 265, 318])
const CHILD_ABORTED = new Set([35, 142, 279])
const CHILD_REJECTED = new Set([7, 190])

const target = { sessionId: 12, messageId: 184 }

const LONG_QUERY = [
  '中国新能源产业政策 2026 年地方配套细则与国家标准的衔接差异，以及制造企业与终端用户在成本、准入和补贴节奏上的不同影响',
  '2026 年 11 月 14 日 公共服务 线上办理 渠道迁移 过渡期 保留窗口 政策原文 附件 办理清单',
  '科研经费管理新规 报销材料 线上流程 过渡安排 官方问答 发布机构 生效时间',
]

interface StressEvent {
  id: string
  tool: string
  stage: 'start' | 'result' | 'error'
  status: 'running' | 'success' | 'error' | 'rejected' | 'aborted'
  offset: number
  callId: string
  parentCallId?: string
  query: string
  summary: string
  error?: string
  phase?: 'executing' | 'rejected' | 'aborted'
  details?: Record<string, unknown>
}

const buildEvents = (): StressEvent[] => {
  const out: StressEvent[] = []
  let offset = 0
  for (let index = 0; index < STRESS_PARENT_COUNT; index += 1) {
    const id = `call_stress_p${String(index).padStart(3, '0')}`
    const failed = PARENT_FAILED.has(index)
    out.push({
      id,
      tool: 'web_search',
      stage: failed ? 'error' : 'result',
      status: failed ? 'error' : 'success',
      offset: (offset += 120),
      callId: id,
      query: LONG_QUERY[index % LONG_QUERY.length],
      summary: failed
        ? `并行搜索未完成：${CHILD_COUNTS[index]} 个子任务中 1 个超时`
        : `搜索完成，自动读取正文 ${CHILD_COUNTS[index] - 1}/${CHILD_COUNTS[index]} 条`,
      error: failed ? 'engine timeout after 30000ms' : undefined,
      details: { engineCount: 2, hitsCount: 8, taskType: 'search' },
    })
    for (let child = 0; child < CHILD_COUNTS[index]; child += 1) {
      const childIndex = out.length
      const childId = `${id}:sub:${child + 1}`
      const isRead = child > 0
      const childFailed = CHILD_FAILED.has(childIndex)
      const childAborted = CHILD_ABORTED.has(childIndex)
      const childRejected = CHILD_REJECTED.has(childIndex)
      const status = childAborted
        ? 'aborted'
        : childRejected
          ? 'rejected'
          : childFailed
            ? 'error'
            : 'success'
      out.push({
        id: childId,
        tool: isRead ? 'read_url' : 'web_search',
        stage: status === 'success' ? 'result' : 'error',
        status,
        offset: (offset += 40),
        callId: childId,
        parentCallId: id,
        query: isRead
          ? `https://www.gov.cn/zhengce/2026-11/14/content_stress_${childIndex}.html`
          : LONG_QUERY[(index + child) % LONG_QUERY.length],
        summary: childAborted
          ? '已中止：本轮剩余读取被取消'
          : childRejected
            ? '未获许可：写入请求被拒绝'
            : childFailed
              ? '读取失败，已回退到搜索摘要'
              : isRead
                ? `已读取正文，约 ${600 + childIndex} 字`
                : `并行搜索完成：命中 ${6 + (childIndex % 5)} 条`,
        error: childFailed
          ? 'Request was cancelled'
          : childAborted
            ? 'aborted by user'
            : childRejected
              ? 'User rejected workspace_write'
              : undefined,
        phase: childAborted ? 'aborted' : childRejected ? 'rejected' : undefined,
        details: {
          taskType: isRead ? 'read_url' : 'search',
          fallbackUsed: childFailed ? 'search_snippet' : undefined,
          truncated: childIndex % 37 === 0 ? true : undefined,
          resultJson:
            childIndex === 11
              ? { note: '长 JSON 用于验证展开后的换行与滚动', rows: Array.from({ length: 24 }, (_, row) => ({ row, value: '合成数据'.repeat(6) })) }
              : undefined,
        },
      })
    }
  }
  return out
}

const terminalEvents: StressEvent[] = buildEvents()

/** 同 id 重复副本：前 200 条各多一条 start，合并后仍为 454 条唯一记录。 */
const rawEvents = terminalEvents.flatMap((event, index) => {
  if (index >= STRESS_DUPLICATE_RECORDS) return [event]
  const startCopy: StressEvent = {
    ...event,
    stage: 'start',
    status: 'running',
    summary: '已派发，等待返回',
    details: { taskType: event.details?.taskType as string | undefined },
  }
  return [startCopy, event]
})

const toolEvents = rawEvents.map(event =>
  previewEvent(target, {
    id: event.id,
    tool: event.tool,
    stage: event.stage,
    status: event.status,
    offset: event.offset,
    callId: event.callId,
    parentCallId: event.parentCallId,
    query: event.query,
    summary: event.summary,
    error: event.error,
    phase: event.phase,
    details: event.details as Parameters<typeof previewEvent>[1]['details'],
  }),
)

const meta = previewMeta({ stableKey: 'preview-stress-184' })

export const stressCase: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: '合成压力夹具：不包含真实推理内容，仅用于验证数百条调用时的滚动与展开。',
  toolEvents,
  content: [
    '## 合成压力数据（非真实运行）',
    '',
    `本案例包含 ${STRESS_TOTAL_RECORDS} 条唯一记录：${STRESS_PARENT_COUNT} 个父调用、${STRESS_SUBTASK_COUNT} 个子任务，另有 ${STRESS_DUPLICATE_RECORDS} 条同 id 重复副本用于验证去重。`,
    '',
    '它不是 Trace97 的明细，也不代表任何真实任务的成功率；页面只验证树形结构、检索筛选、长中文与长 JSON 的可读性。',
  ].join('\n'),
  coverage: {
    trace: { status: 'partial', startedAt: at(0), turnEndedAt: at(120_000), droppedRecords: 12 },
    persisted: { status: 'partial', asOf: at(120_000), truncatedFields: 30 },
    projection: { status: 'partial' },
  },
}
