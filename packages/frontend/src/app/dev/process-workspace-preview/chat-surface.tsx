'use client'

import { useMemo } from 'react'
import { CotTimeline } from '@/components/message-bubble/cot-timeline'
import { ProcessWorkspaceHost } from '@/features/chat/process-workspace'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import type { PreviewCase, PreviewCaseId } from './preview-cases'

/** 用户提问：每个案例一句，保持和来源横幅一致的口径，不写假的任务描述。 */
const PREVIEW_PROMPTS: Record<PreviewCaseId, string> = {
  completed: '查一下今天的中国新闻。',
  running: '查一下今天的中国新闻，重点看政策和民生相关的部分。',
  failure: '查一下今天的政策新闻；正文读不到就说清楚，别把摘要当原文。',
  approval: '帮我梳理 2026 年新能源产业政策的主要变化。',
  trace97: '查一下今天的中国新闻（Trace #97 原始轮次）。',
  stress: '压力验证：把这一轮当作数百次调用的场景，检查树形展开与滚动。',
  empty: '你好。',
  share: '查一下今天的中国新闻。',
  battle: '比较两种模型对中国新闻的整理方式。',
}

/**
 * 聊天侧的验收面，顺序与真实消息一致（message-bubble/index.tsx）：
 * 正文 → 过程入口（CotTimeline）→ 产物。来源不在这里重复，走工作区的"来源"页签。
 * 外面是真的 ProcessWorkspaceHost，所以 ≥1440 双栏 / 768—1439 覆盖 / <768 全屏由产品决定。
 */
export function ChatSurface({ previewCase }: { previewCase: PreviewCase }) {
  const entry = previewCase.entryProps
  const artifacts = entry.artifacts ?? []
  const prompt = PREVIEW_PROMPTS[previewCase.id]
  const content = entry.content ?? ''
  const markdown = useMarkdownRender({
    identity: `preview:${entry.meta.stableKey}`,
    content,
    version: 1,
    isStreaming: Boolean(entry.isStreaming),
    enabled: content.length > 0 && !previewCase.isEmpty,
  })
  const hasContent = useMemo(() => content.trim().length > 0, [content])

  return (
    <ProcessWorkspaceHost className="flex min-h-0 flex-1">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold">今日中国新闻</h1>
            <span className="shrink-0 rounded-md bg-surface-subtle px-1.5 py-0.5 text-[11px] text-muted-foreground">
              演示会话
            </span>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground" data-preview-case={previewCase.id}>
            {previewCase.label}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto" data-preview-scroll="answer">
          <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-4 px-5 py-6 sm:px-6">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-userBubble px-4 py-2.5 text-sm leading-relaxed">
                {prompt}
              </p>
            </div>

            {hasContent ? (
              <div data-preview-answer>
                <MarkdownRenderer
                  html={markdown.html}
                  fallback={content}
                  source={markdown.source}
                  isStreaming={Boolean(entry.isStreaming)}
                  isRendering={markdown.isRendering}
                  errored={markdown.errored}
                />
              </div>
            ) : null}

            {previewCase.isEmpty ? (
              <div className="rounded-lg border border-dashed border-border bg-surface-subtle/60 px-4 py-3 text-xs text-muted-foreground">
                空态：这条消息没有任何过程记录，入口整块消失，不占位、不写 0 次调用。
              </div>
            ) : (
              <CotTimeline {...entry} />
            )}

            {artifacts.length > 0 ? (
              <section aria-label="产物" className="flex flex-col gap-2">
                {artifacts.map(artifact => {
                  const expiresAt = new Date(artifact.expiresAt)
                  return (
                    <div
                      key={artifact.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle/25 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{artifact.fileName}</div>
                        <div className="text-muted-foreground">
                          {(artifact.sizeBytes / 1024).toFixed(1)} KB ·
                          {Number.isNaN(expiresAt.getTime()) ? ' 无过期时间' : ` 过期于 ${expiresAt.toISOString().slice(0, 10)}`}
                        </div>
                      </div>
                      <a
                        className="shrink-0 whitespace-nowrap text-signal hover:underline"
                        href={artifact.downloadUrl}
                        download={artifact.fileName}
                        data-preview-artifact={artifact.id}
                      >
                        下载
                      </a>
                    </div>
                  )
                })}
              </section>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border px-5 py-3 sm:px-6" data-preview-composer>
          <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2 rounded-[var(--radius-composer)] border border-border bg-surface px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {entry.isStreaming ? '正在生成，可停止后续工具…' : '继续提问'}
            </span>
            <span className="shrink-0 rounded-md bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">
              输入框是 dev 夹具
            </span>
          </div>
        </div>
      </div>
    </ProcessWorkspaceHost>
  )
}
