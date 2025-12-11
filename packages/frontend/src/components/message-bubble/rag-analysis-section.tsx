/**
 * RAG 文档分析面板
 * 展示文档检索结果，类似推理链的折叠面板
 */

'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Search, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RAGHit {
  documentId: number
  documentName: string
  content: string
  score: number
  chunkIndex: number
}

export interface DocumentSearchEvent {
  type: 'tool'
  tool: 'document_search'
  stage: 'start' | 'result' | 'error'
  id: string
  query?: string
  hits?: RAGHit[]
  totalHits?: number
  queryTime?: number
  error?: string
}

interface RAGAnalysisSectionProps {
  events: DocumentSearchEvent[]
  defaultExpanded?: boolean
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`
}

function truncateContent(content: string, maxLength: number = 200): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}

export function RAGAnalysisSection({
  events,
  defaultExpanded = false,
}: RAGAnalysisSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // 过滤出文档搜索事件
  const searchEvents = events.filter((e) => e.tool === 'document_search')

  if (searchEvents.length === 0) return null

  // 获取最新的结果事件
  const resultEvent = searchEvents.find((e) => e.stage === 'result')
  const startEvent = searchEvents.find((e) => e.stage === 'start')
  const errorEvent = searchEvents.find((e) => e.stage === 'error')

  const query = startEvent?.query || resultEvent?.query
  const hits = resultEvent?.hits || []
  const totalHits = resultEvent?.totalHits || 0
  const queryTime = resultEvent?.queryTime

  const isSearching = startEvent && !resultEvent && !errorEvent
  const hasError = !!errorEvent

  return (
    <div className="mb-3">
      <div
        className={cn(
          'rounded-lg border transition-colors',
          'bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800'
        )}
      >
        {/* 头部 */}
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 w-full px-3 py-2 text-left',
            'hover:bg-blue-100/50 dark:hover:bg-blue-900/30 rounded-t-lg',
            'transition-colors'
          )}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          )}

          <Search className="h-4 w-4 text-blue-600 dark:text-blue-400" />

          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            文档分析
          </span>

          {isSearching && (
            <span className="text-xs text-blue-500 animate-pulse">检索中...</span>
          )}

          {hits.length > 0 && (
            <span className="text-xs text-blue-500">
              找到 {totalHits} 个相关片段
            </span>
          )}

          {queryTime !== undefined && (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTime(queryTime)}
            </span>
          )}
        </button>

        {/* 展开内容 */}
        {expanded && (
          <div className="px-3 pb-3 space-y-3">
            {/* 查询 */}
            {query && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">查询:</span> {query}
              </div>
            )}

            {/* 错误 */}
            {hasError && (
              <div className="text-sm text-red-600 dark:text-red-400">
                检索失败: {errorEvent?.error}
              </div>
            )}

            {/* 结果列表 */}
            {hits.length > 0 && (
              <div className="space-y-2">
                {hits.map((hit, index) => (
                  <div
                    key={`${hit.documentId}-${hit.chunkIndex}-${index}`}
                    className={cn(
                      'rounded-md border p-2 text-sm',
                      'bg-white dark:bg-gray-900',
                      'border-gray-200 dark:border-gray-700'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium text-xs truncate flex-1">
                        {hit.documentName}
                      </span>
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          hit.score >= 0.7
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : hit.score >= 0.5
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        )}
                      >
                        {formatScore(hit.score)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {truncateContent(hit.content)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* 无结果 */}
            {!isSearching && !hasError && hits.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-2">
                未找到相关文档内容
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
