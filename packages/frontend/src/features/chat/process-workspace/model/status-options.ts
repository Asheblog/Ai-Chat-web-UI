import type { ProcessStatusFilter } from './derived-views'

/** 状态筛选选项：面板与台账共用一份，避免两处漂移。 */
export const PROCESS_STATUS_OPTIONS: ReadonlyArray<{ value: ProcessStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'succeeded', label: '完成' },
  { value: 'failed', label: '失败' },
  { value: 'rejected', label: '未获许可' },
  { value: 'aborted', label: '中止' },
  { value: 'in_flight', label: '进行中' },
  { value: 'degraded', label: '降级' },
  { value: 'orphan', label: '归属未知' },
  { value: 'ambiguous', label: '父调用歧义' },
]
