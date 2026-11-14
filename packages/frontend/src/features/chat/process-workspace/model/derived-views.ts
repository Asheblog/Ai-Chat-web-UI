/**
 * 视图投影：树行、异常分组、来源去重、检索筛选、当前活动。
 * 全部是纯函数，供工作区面板与调用台账共用，不在组件里重复计算。
 */
import type { ProcessIndex, ProcessRecord } from './operation-index'

export type ProcessGrouping = 'by-parent' | 'timeline'

export type ProcessStatusFilter =
  | 'all'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'aborted'
  | 'in_flight'
  | 'degraded'
  | 'orphan'
  | 'ambiguous'

export interface ProcessFilter {
  query: string
  status: ProcessStatusFilter
  onlyAnomalies: boolean
  grouping: ProcessGrouping
  /** 按工具筛选（台账用）。命中的子任务会保留其父链作为"上下文行"。 */
  tool?: string
}

export const EMPTY_PROCESS_FILTER: ProcessFilter = {
  query: '',
  status: 'all',
  onlyAnomalies: false,
  grouping: 'by-parent',
}

const isAnomalous = (record: ProcessRecord): boolean =>
  record.degraded ||
  record.outcome === 'failed' ||
  record.outcome === 'rejected' ||
  record.outcome === 'aborted' ||
  record.relation === 'orphan' ||
  record.relation === 'ambiguous'

export interface ProcessRow {
  id: string
  record: ProcessRecord
  depth: number
  hasChildren: boolean
  /** 孤儿 / 父调用歧义记录单独成组时的组标签 */
  group: 'tree' | 'orphan' | 'ambiguous'
  /**
   * 上下文行：本身没命中筛选，只是为了让命中的子任务仍有父链可读。
   * 上下文行不计入命中数，也不改变状态徽标语义。
   */
  context?: boolean
}

const matchesTool = (record: ProcessRecord, tool?: string): boolean =>
  !tool || tool === 'all' || (record.identifier ?? record.tool) === tool

/** 命中集合（筛选条件全部通过，含工具筛选）。 */
const collectMatchedIds = (index: ProcessIndex, filter: ProcessFilter): Set<string> =>
  new Set(
    index.records
      .filter(
        (record) =>
          matchesQuery(record, filter.query) &&
          matchesStatus(record, filter.status) &&
          (!filter.onlyAnomalies || isAnomalous(record)) &&
          matchesTool(record, filter.tool),
      )
      .map((record) => record.id),
  )

/** 命中记录的祖先 id：工具筛选下保留父链，避免子任务冒充顶层调用。 */
const collectAncestorIds = (index: ProcessIndex, matched: Set<string>): Set<string> => {
  const ancestors = new Set<string>()
  const byId = new Map(index.records.map((record) => [record.id, record]))
  for (const id of matched) {
    let cursor = byId.get(id)?.parentId ?? null
    const guard = new Set<string>()
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor)
      if (matched.has(cursor)) break
      ancestors.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
  }
  return ancestors
}

/** 状态筛选：关系类（归属未知 / 父调用歧义）与结果类各自可筛，不合并成"异常"。 */
const matchesStatus = (record: ProcessRecord, status: ProcessStatusFilter): boolean => {
  if (status === 'all') return true
  if (status === 'degraded') return record.degraded
  if (status === 'orphan') return record.relation === 'orphan'
  if (status === 'ambiguous') return record.relation === 'ambiguous'
  return record.outcome === status
}

const matchesQuery = (record: ProcessRecord, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    record.tool,
    record.identifier,
    record.apiName,
    record.callId,
    record.id,
    record.event.query,
    record.event.summary,
    record.event.details?.title,
    record.event.details?.url,
    record.event.details?.engine,
    record.event.details?.expandedQuery,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export const filterProcessRecords = (
  index: ProcessIndex,
  filter: ProcessFilter,
): ProcessRecord[] =>
  index.records.filter(
    (record) =>
      matchesQuery(record, filter.query) &&
      matchesStatus(record, filter.status) &&
      (!filter.onlyAnomalies || isAnomalous(record)),
  )

const pushSubtree = (
  index: ProcessIndex,
  record: ProcessRecord,
  depth: number,
  rows: ProcessRow[],
  visited: Set<string>,
  allowed: Set<string>,
  contextIds: Set<string>,
) => {
  if (visited.has(record.id) || !allowed.has(record.id)) return
  visited.add(record.id)
  const children = index.children[record.id] ?? []
  rows.push({
    id: record.id,
    record,
    depth,
    hasChildren: children.length > 0,
    group: 'tree',
    context: contextIds.has(record.id) || undefined,
  })
  for (const childId of children) {
    const child = index.records.find((candidate) => candidate.id === childId)
    if (child) pushSubtree(index, child, depth + 1, rows, visited, allowed, contextIds)
  }
}

/**
 * 树行：父调用先出现，子任务缩进跟在后面；孤儿与歧义记录不塞进任何父节点，
 * 各自在末尾成组，保证「不虚构父节点」。
 */
export const buildProcessRows = (index: ProcessIndex, filter: ProcessFilter): ProcessRow[] => {
  const matched = collectMatchedIds(index, filter)
  const contextIds = collectAncestorIds(index, matched)
  const allowed = new Set<string>([...matched, ...contextIds])
  const rows: ProcessRow[] = []
  const visited = new Set<string>()

  if (filter.grouping === 'timeline') {
    for (const record of index.records) {
      if (!allowed.has(record.id)) continue
      rows.push({
        id: record.id,
        record,
        depth: 0,
        hasChildren: (index.children[record.id] ?? []).length > 0,
        group: record.relation === 'orphan' ? 'orphan' : record.relation === 'ambiguous' ? 'ambiguous' : 'tree',
        context: contextIds.has(record.id) || undefined,
      })
    }
    return rows
  }

  for (const rootId of index.roots) {
    if (!allowed.has(rootId)) continue
    const root = index.records.find((record) => record.id === rootId)
    if (root) pushSubtree(index, root, 0, rows, visited, allowed, contextIds)
  }

  for (const record of index.records) {
    if (!allowed.has(record.id) || visited.has(record.id)) continue
    const group = record.relation === 'orphan' || record.relation === 'ambiguous' ? record.relation : 'tree'
    rows.push({
      id: record.id,
      record,
      depth: 0,
      hasChildren: false,
      group,
      context: contextIds.has(record.id) || undefined,
    })
    visited.add(record.id)
  }

  return rows
}

export interface ProcessRowGroup {
  row: ProcessRow
  /** 挂在父行下面的子记录：父行展开时才渲染 */
  children: ProcessRow[]
}

/**
 * 把树行按父调用归组：子任务不单独占首屏位置，父行展开后才出现。
 * 更深层的行按深度挂到最近的祖先组，保持缩进。
 */
export const groupProcessRows = (rows: ProcessRow[]): ProcessRowGroup[] => {
  const groups: ProcessRowGroup[] = []
  const stack: Array<{ depth: number; group: ProcessRowGroup }> = []
  for (const row of rows) {
    if (row.depth === 0) {
      const group: ProcessRowGroup = { row, children: [] }
      groups.push(group)
      stack.length = 0
      stack.push({ depth: 0, group })
      continue
    }
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.group.children.push(row)
      stack.push({ depth: row.depth, group: parent.group })
    } else {
      groups.push({ row, children: [] })
    }
  }
  return groups
}

export type ProcessAnomalyKind = 'failed' | 'rejected' | 'aborted' | 'degraded' | 'orphan' | 'ambiguous'

export interface ProcessAnomalyGroup {
  kind: ProcessAnomalyKind
  label: string
  ids: string[]
}

const ANOMALY_LABELS: Record<ProcessAnomalyKind, string> = {
  failed: '失败',
  rejected: '未获许可',
  aborted: '中止',
  degraded: '降级',
  orphan: '归属未知',
  ambiguous: '父调用歧义',
}

/** 异常分组：失败 / 未获许可 / 中止 / 降级 / 归属未知 / 歧义各自独立，不合并成"出错"。 */
export const groupProcessAnomalies = (index: ProcessIndex): ProcessAnomalyGroup[] => {
  const buckets: Record<ProcessAnomalyKind, string[]> = {
    failed: [], rejected: [], aborted: [], degraded: [], orphan: [], ambiguous: [],
  }
  for (const record of index.records) {
    if (record.outcome === 'failed') buckets.failed.push(record.id)
    if (record.outcome === 'rejected') buckets.rejected.push(record.id)
    if (record.outcome === 'aborted') buckets.aborted.push(record.id)
    if (record.degraded) buckets.degraded.push(record.id)
    if (record.relation === 'orphan') buckets.orphan.push(record.id)
    if (record.relation === 'ambiguous') buckets.ambiguous.push(record.id)
  }
  return (Object.keys(buckets) as ProcessAnomalyKind[])
    .filter((kind) => buckets[kind].length > 0)
    .map((kind) => ({ kind, label: ANOMALY_LABELS[kind], ids: buckets[kind] }))
}
