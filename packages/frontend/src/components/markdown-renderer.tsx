'use client'

import { memo, useId, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useMarkdownRender } from '@/hooks/use-markdown-render'
import { TerminalCodeBlock } from '@/components/terminal-code-block'

interface MarkdownRendererProps {
  html?: string | null
  fallback: string
  source?: string
  managed?: boolean
  errored?: boolean
  isStreaming?: boolean
  isRendering?: boolean
}

type CodeMarkerPart =
  | { type: 'html'; html: string }
  | { type: 'code'; language: string; code: string }

const CODE_BLOCK_MARKER_RE = /<!--AICHAT_CODE_BLOCK:([A-Za-z0-9_-]+)-->/

const decodeBase64Url = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (padded.length % 4)) % 4
  const normalized = `${padded}${'='.repeat(padLen)}`
  try {
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    const buf = (globalThis as any).Buffer
    if (!buf) throw new Error('Base64 decoding not supported')
    return buf.from(normalized, 'base64').toString('utf8')
  }
}

const splitHtmlByCodeMarkers = (html: string): CodeMarkerPart[] | null => {
  if (!html) return null
  if (!CODE_BLOCK_MARKER_RE.test(html)) return null

  const parts: CodeMarkerPart[] = []
  let rest = html
  while (true) {
    const match = rest.match(CODE_BLOCK_MARKER_RE)
    if (!match || match.index == null) break
    const before = rest.slice(0, match.index)
    if (before) parts.push({ type: 'html', html: before })

    const encoded = match[1]
    try {
      const decoded = decodeBase64Url(encoded)
      const payload = JSON.parse(decoded) as {
        language?: string
        code?: string
      }
      parts.push({
        type: 'code',
        language:
          typeof payload.language === 'string' ? payload.language : '',
        code: typeof payload.code === 'string' ? payload.code : '',
      })
    } catch {
      parts.push({ type: 'html', html: match[0] })
    }

    rest = rest.slice(match.index + match[0].length)
  }
  if (rest) parts.push({ type: 'html', html: rest })
  return parts
}


export const MarkdownRenderer = memo(function MarkdownRenderer({ html, fallback, source, managed = false, errored = false, isStreaming = false, isRendering }: MarkdownRendererProps) {
  const id = useId()
  const snapshot = useRef({ text: fallback, version: 0 })
  if (snapshot.current.text !== fallback) snapshot.current = { text: fallback, version: snapshot.current.version + 1 }
  const external = Boolean(html?.trim() && (source === undefined || fallback.startsWith(source)))
  const markdown = useMarkdownRender({ identity: id, content: fallback, version: snapshot.current.version, isStreaming, enabled: !managed && !external })
  const renderedHtml = external ? html! : markdown.html ?? ''
  const renderedSource = external ? source ?? fallback : markdown.source
  const tail = renderedHtml ? fallback.slice(renderedSource.length) : fallback
  const parts = useMemo(() => splitHtmlByCodeMarkers(renderedHtml), [renderedHtml])
  if (!fallback && !renderedHtml) return null
  return (
    <div className={cn('markdown-body prose prose-zinc dark:prose-invert max-w-none break-words', (isStreaming || isRendering || markdown.isRendering) && 'markdown-body--pending')}>
      {parts ? parts.map((part, index) => part.type === 'html'
        ? <div key={'html-' + index} dangerouslySetInnerHTML={{ __html: part.html }} />
        : <TerminalCodeBlock key={'code-' + index} code={part.code} language={part.language} isStreaming={isStreaming} />)
        : renderedHtml ? <div dangerouslySetInnerHTML={{ __html: renderedHtml }} /> : null}
      {tail && <pre data-markdown-fallback className='my-0 whitespace-pre-wrap break-words bg-transparent p-0 font-inherit text-inherit'>{tail}</pre>}
      {(errored || markdown.errored) && <span className='text-micro text-muted-foreground'>格式渲染暂不可用，已显示完整文本</span>}
    </div>
  )
})
