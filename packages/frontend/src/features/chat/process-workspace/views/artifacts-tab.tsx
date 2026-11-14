'use client'

import { Download, FileText, Paperclip } from 'lucide-react'
import type { WorkspaceArtifact } from '@/types'
import { formatByteSize } from '../model/scope'
import { ProcessChip } from './status'
import { ProcessEmptyState } from './notices'

/** 产物：沿用消息上真实的 artifacts（downloadUrl / expired），不做假的预览壳。 */
export function ProcessArtifactsTab({ artifacts }: { artifacts: WorkspaceArtifact[] }) {
  if (artifacts.length === 0) {
    return (
      <ProcessEmptyState
        title="本轮没有产物"
        hint="导出文件、生成的文档会出现在这里，下载入口保持在回答原文处。"
      />
    )
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="产物列表">
      {artifacts.map((artifact) => {
        const expired = artifact.expired === true
        const size = formatByteSize(artifact.sizeBytes)
        return (
          <li key={artifact.id} className="v2-panel flex items-start gap-2 px-3 py-2">
            <FileText aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{artifact.fileName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
                <span className="[overflow-wrap:anywhere]">{artifact.mimeType}</span>
                {size && <span className="num-tabular">{size}</span>}
                {expired && <ProcessChip tone="warning">已过期</ProcessChip>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {!expired && (
                <>
                  <a
                    href={artifact.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-caption text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Paperclip aria-hidden className="h-3.5 w-3.5" />
                    预览
                  </a>
                  <a
                    href={artifact.downloadUrl}
                    download={artifact.fileName}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-caption text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Download aria-hidden className="h-3.5 w-3.5" />
                    下载
                  </a>
                </>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
