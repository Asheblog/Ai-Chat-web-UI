/**
 * dev 验收页的案例注册表：九个状态 + 每个案例的来源口径。
 *
 * 三条硬规矩（页面横幅与测试都依赖它）：
 * 1. trace97 只回放导出真实保留的 10 条明细，454/378 分别标注，不做相减推算；
 * 2. stress 的 454 条是**合成**压力数据，必须显式标注；
 * 3. 命令一律是交互夹具，返回文案里写明"夹具"，不冒充生产接口。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { completedCase } from './fixtures/completed-case'
import { runningCase } from './fixtures/running-case'
import { failureCase } from './fixtures/failure-case'
import { approvalCase } from './fixtures/approval-case'
import { emptyCase } from './fixtures/empty-case'
import { battleCase, shareCase } from './fixtures/readonly-cases'
import { TRACE97_DATASET, trace97Case } from './fixtures/trace97-case'
import {
  STRESS_DUPLICATE_RECORDS,
  STRESS_PARENT_COUNT,
  STRESS_SUBTASK_COUNT,
  STRESS_TOTAL_RECORDS,
  stressCase,
} from './fixtures/stress-case'

export const PREVIEW_CASE_IDS = [
  'completed',
  'running',
  'failure',
  'approval',
  'trace97',
  'stress',
  'empty',
  'share',
  'battle',
] as const

export type PreviewCaseId = (typeof PREVIEW_CASE_IDS)[number]

export type PreviewProvenanceKind = 'illustrative' | 'trace97-excerpt' | 'synthesized'

export interface PreviewProvenanceFact {
  label: string
  value: string
}

export interface PreviewProvenance {
  kind: PreviewProvenanceKind
  /** 横幅标题：一句话说明这份数据是什么 */
  title: string
  /** 数据口径：写清示例、导出事实与不可推断的部分 */
  detail: string
  facts?: PreviewProvenanceFact[]
}

export interface PreviewCase {
  id: PreviewCaseId
  /** 案例条上的短标签 */
  label: string
  /** 这个案例验收什么 */
  summary: string
  provenance: PreviewProvenance
  /** 真实 Entry 的 props；dev 页直接交给 CotTimeline */
  entryProps: ProcessWorkspaceEntryProps
  /** 该案例本身就没有过程记录，Entry 应整块消失 */
  isEmpty?: boolean
}

const formatClock = (value: number): string => {
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const PREVIEW_CASES: Record<PreviewCaseId, PreviewCase> = {
  completed: {
    id: 'completed',
    label: '完成',
    summary: '完成后收成一行摘要，展开看 4 阶段 · 12 次调用、18 条命中、2 个产物',
    provenance: {
      kind: 'illustrative',
      title: '演示数据 · 不是实时新闻',
      detail:
        '调用结构、来源与产物是手工整理的示例，用于验收完成态的层级、去重与下载；正文不代表任何真实检索结果。',
      facts: [
        { label: '父调用 4 · 子任务 8', value: '12 条唯一记录' },
        { label: '引用命中 18 条', value: '去重后 12 个来源' },
        { label: '产物 2 个', value: 'dev 示例文件可下载' },
      ],
    },
    entryProps: completedCase,
  },
  running: {
    id: 'running',
    label: '运行',
    summary: '两个调用在跑，可停止后续工具或用已有资料作答；命令为交互夹具',
    provenance: {
      kind: 'illustrative',
      title: '演示数据 · 命令是交互夹具',
      detail:
        '运行态记录是构造的；停止工具与取消命令只记录点击，不发真实请求，返回文案里写明"夹具"。',
      facts: [
        { label: '在途 2 条', value: 'search + read_url' },
        { label: '覆盖 trace complete', value: '轮次未结束，无 turnEndedAt' },
      ],
    },
    entryProps: runningCase,
  },
  failure: {
    id: 'failure',
    label: '部分异常',
    summary: '失败 1 · 未获许可 1 · 中止 1 · 降级 1，影响 3 个父调用；答案仍是降级作答',
    provenance: {
      kind: 'illustrative',
      title: '演示数据 · 四种异常分开计数',
      detail:
        '失败、未获许可、中止、降级各按唯一记录计数；覆盖缺口写明丢弃 6 条记录、裁剪 12 个字段，不写成功率。',
      facts: [
        { label: 'failed 1 / rejected 1 / aborted 1', value: 'degraded 1' },
        { label: 'persisted partial', value: '丢记录 6 · 裁字段 12' },
      ],
    },
    entryProps: failureCase,
  },
  approval: {
    id: 'approval',
    label: '待确认',
    summary: '研究计划等待确认：3 个子问题、预计 4—8 轮；只转发真实审批通道',
    provenance: {
      kind: 'illustrative',
      title: '演示数据 · 审批只走真实通道',
      detail:
        '计划内容来自 details.plan 的形状；决策命令是交互夹具，不新建通用工具审批体系。',
      facts: [
        { label: '待批准计划 1 份', value: '3 个子问题 · 4—8 轮' },
        { label: 'in_flight 1', value: 'pending_approval' },
      ],
    },
    entryProps: approvalCase,
  },
  trace97: {
    id: 'trace97',
    label: 'Trace97',
    summary: '真实导出：只保留 10 条明细；454 最终记录、378 生命周期更新分别标注',
    provenance: {
      kind: 'trace97-excerpt',
      title: '原导出摘录 · 不补造明细',
      detail: [
        `导出只保留 ${TRACE97_DATASET.retainedDetailCount} 条明细，其余记录只有计数没有 payload，因此不展示原文、命中与尝试次数。`,
        `454 是整轮按 id 合并后的最终记录数（父调用 + 子任务），不是唯一调用数，也不能与其他数字相减求成功率。`,
        `378 是观测窗口 ${formatClock(TRACE97_DATASET.startedAt)}—${formatClock(TRACE97_DATASET.traceWindowEndedAt)} 内的工具生命周期更新（start/result/error 都算一次更新），整轮在 ${formatClock(TRACE97_DATASET.turnEndedAt)} 结束。`,
        '父子关系来自导出记录 id 的前缀命名（父callId:phase:n），不是导出字段，横幅在此声明。',
      ].join(''),
      facts: [
        { label: '454', value: '整轮最终记录数（按 id 合并）' },
        { label: '378', value: '窗口内生命周期更新' },
        { label: '10', value: '导出保留明细条数' },
        {
          label: `观测窗口 ${formatClock(TRACE97_DATASET.startedAt)}—${formatClock(TRACE97_DATASET.traceWindowEndedAt)}`,
          value: `整轮结束 ${formatClock(TRACE97_DATASET.turnEndedAt)}`,
        },
      ],
    },
    entryProps: trace97Case,
  },
  stress: {
    id: 'stress',
    label: '合成压力',
    summary: '合成 454 条记录（120 父 + 334 子）与 200 条同 id 重复副本，验证树与滚动',
    provenance: {
      kind: 'synthesized',
      title: '合成压力数据 · 不是 Trace97 明细',
      detail: [
        `本案例是脚本生成的合成数据：${STRESS_TOTAL_RECORDS} 条唯一记录（${STRESS_PARENT_COUNT} 父 + ${STRESS_SUBTASK_COUNT} 子），另有 ${STRESS_DUPLICATE_RECORDS} 条同 id 重复副本。`,
        '它不是 Trace97 的明细，也不代表任何真实运行：数字与 Trace97 相同只是刻意对齐压力规模，来源与口径完全不同。',
      ].join(''),
      facts: [
        { label: `${STRESS_TOTAL_RECORDS} 唯一记录`, value: '合成' },
        { label: `${STRESS_DUPLICATE_RECORDS} 条重复副本`, value: '验证同 id 合并' },
      ],
    },
    entryProps: stressCase,
  },
  empty: {
    id: 'empty',
    label: '空态',
    summary: '没有过程记录：Entry 整块消失，不占位、不写 0 次调用',
    provenance: {
      kind: 'illustrative',
      title: '空数据 · 不伪造进度',
      detail: '零事件、零产物、无推理原文；覆盖三层都是 unknown，界面不得显示成完整。',
    },
    entryProps: emptyCase,
    isEmpty: true,
  },
  share: {
    id: 'share',
    label: '分享只读',
    summary: '分享快照只读：可展开过程与来源，不可停止、取消或重新生成',
    provenance: {
      kind: 'illustrative',
      title: '演示数据 · 分享只读',
      detail: '分享复用同一份树投影；旧数据缺覆盖证据时标 unknown，不当成完整记录。',
      facts: [{ label: 'readOnly', value: '无 commands' }],
    },
    entryProps: shareCase,
  },
  battle: {
    id: 'battle',
    label: 'Battle',
    summary: 'Battle 单模型 run：sessionId 0，与聊天会话隔离，统计不跨模型相加',
    provenance: {
      kind: 'illustrative',
      title: '演示数据 · Battle 隔离',
      detail: '每个 run 一份过程与台账；会话 id 为 0，即使漏传只读也不能派发聊天命令。',
      facts: [{ label: 'sessionId 0', value: 'origin battle' }],
    },
    entryProps: battleCase,
  },
}

export const resolvePreviewCase = (raw?: string | null): PreviewCase => {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return (PREVIEW_CASES as Record<string, PreviewCase | undefined>)[value] ?? PREVIEW_CASES.completed
}
