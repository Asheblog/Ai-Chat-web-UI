'use client'

import { useMemo } from 'react'
import {
  buildProcessIndex,
  buildProcessSummary,
  type ProcessIndex,
  type ProcessSummary,
} from '../model/process-model'
import { groupProcessAnomalies } from '../model/derived-views'
import { collectProcessSources, resolveProcessActivity } from '../model/record-display'
import { describeRunTerminal, resolveRunTerminal, type ProcessRunTerminalView } from '../model/scope'
import type { ProcessSnapshot } from '../types'

export interface ProcessModel {
  index: ProcessIndex
  summary: ProcessSummary
  sources: ReturnType<typeof collectProcessSources>
  anomalies: ReturnType<typeof groupProcessAnomalies>
  activity: string | null
  terminal: ProcessRunTerminalView
  isEmpty: boolean
}

/** 一次快照 → 全部派生数据。纯计算，组件不重复推导。 */
export function useProcessModel(snapshot: ProcessSnapshot): ProcessModel {
  const { toolEvents, coverage, meta, runTerminal, reasoningRaw } = snapshot

  return useMemo(() => {
    const index = buildProcessIndex({ events: toolEvents ?? [], coverage })
    const summary = buildProcessSummary(index)
    return {
      index,
      summary,
      sources: collectProcessSources(index),
      anomalies: groupProcessAnomalies(index),
      activity: resolveProcessActivity(index),
      terminal: describeRunTerminal(resolveRunTerminal(meta, runTerminal)),
      isEmpty: index.records.length === 0 && !reasoningRaw?.trim(),
    }
  }, [toolEvents, coverage, meta, runTerminal, reasoningRaw])
}
