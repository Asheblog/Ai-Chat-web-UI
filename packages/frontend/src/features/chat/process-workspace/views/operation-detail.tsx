'use client'

import { useState } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import type { ProcessRecord } from '../model/process-model'
import type { ProcessWorkspaceCommands } from '../types'
import { ProcessChip } from './status'
import { ResearchPlanSection } from './research-plan-section'

const stringify = (value: unknown): string => {
  try {
    const text = JSON.stringify(value, null, 2)
    return text ?? String(value)
  } catch {
    return String(value)
  }
}

const formatValue = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() ? value : null
  if (typeof value === 'object') return stringify(value)
  return String(value)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-caption font-medium text-foreground">{title}</h4>
      {children}
    </section>
  )
}

function PreBlock({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg border border-code-border bg-codeBg px-2.5 py-2 font-mono text-micro leading-5 text-foreground [overflow-wrap:anywhere]">
      {text}
    </pre>
  )
}

/** 尝试与降级：只写记录自带的证据，没有证据就不出现次数。 */
function RecoverySection({ record }: { record: ProcessRecord }) {
  const { attempts, retried, fallbackUsed } = record.recovery
  // 只有 truncated 的记录也必须能看到"结果被截断"，不能因早退条件漏掉警示
  if (attempts === undefined && !fallbackUsed && !record.degraded && !record.truncated) return null
  return (
    <Section title="尝试与降级">
      <div className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
        {attempts !== undefined && (
          <ProcessChip>
            <span className="num-tabular">尝试 {attempts} 次</span>
            {retried && <span className="text-[hsl(var(--warning))]">· 已重试</span>}
          </ProcessChip>
        )}
        {fallbackUsed && <ProcessChip tone="warning">降级为 {fallbackUsed}</ProcessChip>}
        {record.degraded && !fallbackUsed && <ProcessChip tone="warning">结果降级</ProcessChip>}
        {record.truncated && <ProcessChip>结果被截断</ProcessChip>}
      </div>
      <p className="text-micro text-muted-foreground">
        未记录尝试次数的调用不会显示次数；降级与最终结果分开说明。
      </p>
    </Section>
  )
}

const HITS_PREVIEW = 8

export function ProcessOperationDetail({
  record,
  canCommand,
  commands,
}: {
  record: ProcessRecord
  canCommand: boolean
  commands?: ProcessWorkspaceCommands
}) {
  const { event } = record
  const [showAllHits, setShowAllHits] = useState(false)
  const argumentsText = formatValue(event.argumentsText) ?? formatValue(event.details?.argumentsText)
  const resultText = formatValue(event.resultText) ?? formatValue(event.details?.resultText)
  const resultJson = resultText ? null : formatValue(event.resultJson)
  const errorText = formatValue(event.error) ?? formatValue(event.details?.errorCode)
  const hits = Array.isArray(event.hits) ? event.hits : []
  const rawRecord = {
    id: record.id,
    callId: record.callId ?? null,
    parentCallId: record.parentCallId ?? null,
    relation: record.relation,
    status: record.status,
    outcome: record.outcome,
    stage: record.stage,
    phase: record.phase ?? null,
    source: record.source ?? null,
    duplicateCount: record.duplicateCount,
    hits: event.hits ?? [],
    details: event.details ?? null,
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border px-2.5 py-2.5 text-sm">
      <Section title="原始输入">
        {argumentsText ? (
          <PreBlock text={argumentsText} />
        ) : (
          <p className="text-caption text-muted-foreground">该调用没有可用参数记录</p>
        )}
      </Section>

      <Section title="结果">
        {resultText ? (
          <PreBlock text={resultText} />
        ) : resultJson ? (
          <PreBlock text={resultJson} />
        ) : errorText ? (
          <p className="rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-2.5 py-2 text-caption text-destructive [overflow-wrap:anywhere]">
            {errorText}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">还没有结果记录</p>
        )}
      </Section>

      {hits.length > 0 && (
        <Section title={`命中 ${hits.length} 条`}>
          <ul className="flex flex-col gap-1">
            {(showAllHits ? hits : hits.slice(0, HITS_PREVIEW)).map((hit, index) => (
              <li key={index} className="flex min-w-0 items-start gap-1 text-caption">
                <ExternalLink aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <a
                  href={hit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 text-foreground underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                >
                  {hit.title || hit.url}
                </a>
              </li>
            ))}
          </ul>
          {hits.length > HITS_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAllHits((current) => !current)}
              aria-expanded={showAllHits}
              className="mt-1 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAllHits ? '收起命中' : `展开其余 ${hits.length - HITS_PREVIEW} 条命中`}
            </button>
          )}
        </Section>
      )}

      <RecoverySection record={record} />
      <ResearchPlanSection record={record} canCommand={canCommand} commands={commands} />

      <details className="rounded-lg border border-border bg-surface px-2.5 py-2">
        <summary className="cursor-pointer text-caption font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          原始记录
        </summary>
        <div className="mt-1.5">
          <PreBlock text={stringify(rawRecord)} />
        </div>
      </details>

      {record.childIds.length > 0 && (
        <p className="flex items-center gap-1 text-micro text-muted-foreground">
          <RotateCcw aria-hidden className="h-3 w-3" />
          该父调用下有 {record.childIds.length} 个子任务，展开父行可见
        </p>
      )}
    </div>
  )
}