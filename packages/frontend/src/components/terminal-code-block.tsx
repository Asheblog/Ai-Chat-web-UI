'use client'

import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyToClipboard, cn } from '@/lib/utils'

const HighlightedCode = lazy(() => import('./syntax-highlight'))

export const TerminalCodeBlock = memo(function TerminalCodeBlock({ code, language, isStreaming = false }: {
  code: string; language: string; isStreaming?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const content = code.endsWith(String.fromCharCode(10)) ? code.slice(0, -1) : code
  const normalized = ['sh', 'shell', 'zsh', 'console'].includes(language.toLowerCase()) ? 'bash' : language.toLowerCase()
  const plain = !normalized || ['text', 'txt', 'plaintext', 'nohighlight'].includes(normalized)
  const skipHighlight = isStreaming || plain || content.length > 20000 || content.split(String.fromCharCode(10)).length > 400
  const raw = <pre className={cn('m-0 whitespace-pre-wrap break-words px-3 py-3 text-sm', isStreaming && 'typing-cursor')}><code>{content}</code></pre>
  if (!content) return null
  return (
    <div className='rs-terminal relative my-2 min-w-0 max-w-full rounded-xl border border-[hsl(var(--code-border))] bg-[hsl(var(--code-bg))] pt-8 text-[hsl(var(--code-text))]'>
      <div className='absolute inset-x-0 top-0 flex h-7 items-center gap-2 border-b border-[hsl(var(--code-border))] bg-[hsl(var(--code-header))/0.85] px-3'>
        <span aria-hidden className='h-3 w-3 rounded-full bg-[#ff5f56]' />
        <span aria-hidden className='h-3 w-3 rounded-full bg-[#ffbd2e]' />
        <span aria-hidden className='h-3 w-3 rounded-full bg-[#27c93f]' />
        {!plain && <span className='ml-2 text-[11px] text-muted-foreground'>{normalized}</span>}
        <Button variant='ghost' size='icon' className='ml-auto h-6 w-6 text-muted-foreground' title='复制代码' aria-label={copied ? '已复制代码' : '复制代码'} onClick={async () => {
          try {
            await copyToClipboard(content)
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 2000)
          } catch { console.warn('[code-block] copy-failed') }
        }}>{copied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}</Button>
      </div>
      {skipHighlight ? raw : <Suspense fallback={raw}><HighlightedCode code={content} language={normalized} /></Suspense>}
    </div>
  )
})
