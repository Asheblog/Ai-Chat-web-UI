'use client'

import type { ChatShare } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { cn, formatDate } from '@/lib/utils'

interface ShareViewerProps {
  share: ChatShare
}

export function ShareViewer({ share }: ShareViewerProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
        <header className="space-y-2 border-b pb-6">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">共享内容</p>
          <h1 className="text-3xl font-semibold">{share.title || share.sessionTitle}</h1>
          <div className="text-sm text-muted-foreground">
            <p>来自会话《{share.sessionTitle}》</p>
            <p>分享时间：{formatDate(share.createdAt)} · 共 {share.messageCount} 条消息</p>
          </div>
        </header>

        <section className="space-y-4">
          {share.messages.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
              分享中暂无可展示的内容
            </div>
          ) : (
            share.messages.map((msg) => (
              <article
                key={`${msg.id}-${msg.createdAt}`}
                className={cn(
                  'rounded-xl border shadow-sm',
                  msg.role === 'user' ? 'bg-muted/40' : 'bg-background',
                )}
              >
                <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {msg.role === 'user' ? '用户' : 'AI'}
                  </span>
                  <span>{formatDate(msg.createdAt)}</span>
                </div>
                <div className="px-4 py-3">
                  <MarkdownRenderer html={null} fallback={msg.content} />
                  {msg.images && msg.images.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {msg.images.map((src, index) => (
                        <img
                          key={`${src}-${index}`}
                          src={src}
                          alt="分享图片"
                          className="max-h-48 w-full rounded-md object-contain border bg-white"
                        />
                      ))}
                    </div>
                  )}
                  {msg.reasoning && msg.reasoning.trim().length > 0 && (
                    <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {msg.reasoning}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
