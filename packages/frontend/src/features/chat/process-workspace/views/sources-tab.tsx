'use client'

import { ExternalLink } from 'lucide-react'
import type { ProcessSource } from '../model/record-display'
import { ProcessEmptyState } from './notices'

interface ProcessSourcesProps {
  sources: ProcessSource[]
}

/**
 * 来源去重后的清单。order 只是清单顺序号：正文引用编号由内容生产方决定，
 * 这里不对齐也不声称一致；每条来源本身就是外链，原版也没有"定位到正文"的能力。
 */
export function ProcessSourcesTab({ sources }: ProcessSourcesProps) {
  if (sources.length === 0) {
    return (
      <ProcessEmptyState
        title="本轮没有可定位的来源"
        hint="只有工具返回了带链接的命中或正文才会计入来源；缺失的命中不会补造。"
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-micro text-muted-foreground">
        共 {sources.length} 条来源，已按链接去重；序号是本清单顺序，不代表正文引用编号
      </p>
      <ul className="flex flex-col gap-2" aria-label="来源列表">
        {sources.map((source) => (
          <li key={source.url} className="v2-panel px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="num-tabular mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-soft px-1 text-micro font-medium text-signal-text">
                {source.order}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                >
                  <span className="min-w-0">{source.title}</span>
                  <ExternalLink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
                <p className="mt-0.5 text-micro text-muted-foreground [overflow-wrap:anywhere]">
                  {source.siteName ? source.siteName + ' · ' : ''}
                  {source.tools.join(' / ')}
                  {source.imageCount !== undefined && source.imageCount > 0 ? ` · 共 ${source.imageCount} 张图` : ''}
                </p>
                {source.leadImageUrl && (
                  <figure className="mt-1.5">
                    <img
                      src={source.leadImageUrl}
                      alt={source.title}
                      loading="lazy"
                      className="h-16 w-24 rounded-md border border-border object-cover"
                    />
                    <figcaption className="mt-0.5 text-micro text-muted-foreground">
                      主图{source.imageCount !== undefined && source.imageCount > 0 ? ` · 共 ${source.imageCount} 张` : ''}
                    </figcaption>
                  </figure>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
