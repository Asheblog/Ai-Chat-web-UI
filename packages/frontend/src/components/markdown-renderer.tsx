'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ensureKatexResources } from '@/lib/load-katex'
import {
  remarkKatexTokenizer,
  containsLatexTokens,
  defaultRemarkMathOptions,
  encodeLatexPlaceholders,
} from '@aichat/shared/latex-normalizer'

interface MarkdownRendererProps {
  html?: string | null
  fallback: string
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
      const payload = JSON.parse(decoded) as { language?: string; code?: string }
      parts.push({
        type: 'code',
        language: typeof payload.language === 'string' ? payload.language : '',
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

export const MarkdownRenderer = memo(function MarkdownRenderer({
  html,
  fallback,
  isStreaming,
  isRendering,
}: MarkdownRendererProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [rehypeKatexPlugin, setRehypeKatexPlugin] = useState<any>(null)
  const trimmedHtml = html?.trim() ?? ''
  const codeMarkerParts = useMemo(() => splitHtmlByCodeMarkers(trimmedHtml), [trimmedHtml])

  const needsMathSupport = useMemo(() => {
    if (trimmedHtml && /katex/i.test(trimmedHtml)) {
      return true
    }
    if (!fallback) {
      return false
    }
    if (containsLatexTokens(fallback)) return true
    return /(\$\$?|\\\[|\\\(|\\begin\{|\\end\{|\\ce\{|\\pu\{|\\frac|\\sum|\\int|\\sqrt|\\alpha|\\beta|\\gamma)/i.test(
      fallback,
    )
  }, [trimmedHtml, fallback])

  useEffect(() => {
    let active = true
    if (!needsMathSupport || rehypeKatexPlugin) {
      return () => {
        active = false
      }
    }
    ensureKatexResources()
      .then(({ rehypeKatex }) => {
        if (!active || !rehypeKatex) return
        setRehypeKatexPlugin(() => rehypeKatex)
      })
      .catch((error) => {
        console.error('Failed to load KaTeX resources', error)
      })
    return () => {
      active = false
    }
  }, [needsMathSupport, rehypeKatexPlugin])

  const preparedFallback = useMemo(() => encodeLatexPlaceholders(fallback || ''), [fallback])

  const fallbackHasCodeBlocks = useMemo(() => {
    if (!fallback) return false
    if (/(^|\n)\s*(```|~~~)/.test(fallback)) return true
    if (/(^|\n)(?:\t| {4,})\S/.test(fallback)) return true
    return false
  }, [fallback])
  const preferPlainStreamingFallback = useMemo(() => {
    if (!isStreaming || !fallback) return false
    return fallback.length > 1200 || fallbackHasCodeBlocks || needsMathSupport
  }, [fallback, fallbackHasCodeBlocks, isStreaming, needsMathSupport])

  const handleCopyCode = async (code: string) => {
    try {
      if (typeof window !== 'undefined' && navigator?.clipboard && (window.isSecureContext ?? true)) {
        await navigator.clipboard.writeText(code)
      } else {
        if (typeof document === 'undefined') {
          throw new Error('当前环境不支持剪贴板操作')
        }
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        ta.style.top = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (error) {
      console.error('Failed to copy code:', error)
    }
  }

  const TerminalCodeBlock = ({ code, language }: { code: string; language: string }) => {
    const lang0 = (language || '').toLowerCase()
    const normalized = ['bash', 'sh', 'shell', 'zsh', 'console'].includes(lang0) ? 'bash' : lang0
    const isPlain = !normalized || ['plaintext', 'text', 'txt', 'nohighlight'].includes(normalized)
    const codeContent = String(code || '').replace(/\n$/, '')
    if (!codeContent) return null

    const tooLargeForHL = Boolean(
      isStreaming || codeContent.length > 20000 || codeContent.split('\n').length > 400,
    )
    const isSingleLine = !codeContent.includes('\n')
    const isShortPlain = isPlain && isSingleLine && codeContent.trim().length <= 80

    if (isShortPlain) {
      return (
        <div className="my-2">
          <code
            className={cn(
              'px-1.5 py-0.5 rounded text-sm font-mono bg-muted/30 break-words whitespace-pre-wrap',
              isStreaming && 'typing-cursor',
            )}
          >
            {codeContent}
          </code>
        </div>
      )
    }

    if (tooLargeForHL) {
      return (
        <div
          className={cn(
            'relative group rounded-xl my-2 bg-[hsl(var(--code-bg))] border border-[hsl(var(--code-border))] text-[hsl(var(--code-text))] rs-terminal pt-8 max-w-full min-w-0',
          )}
        >
          <div className="absolute left-0 right-0 top-0 h-7 px-3 flex items-center gap-2 border-b border-[hsl(var(--code-border))] bg-[hsl(var(--code-header))/0.85]">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
            {!isPlain && <span className="ml-2 text-[11px] text-muted-foreground">{normalized}</span>}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 z-10 text-muted-foreground opacity-90 hover:opacity-100"
              onClick={() => handleCopyCode(codeContent)}
              title="复制代码"
              aria-label="复制代码"
            >
              {copiedCode === codeContent ? (
                <div className="h-3 w-3 bg-green-500 rounded" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
          <pre
            className={cn('m-0 text-sm px-3 py-3', isStreaming && 'typing-cursor')}
            style={{
              background: 'transparent',
              color: 'hsl(var(--code-text))',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowX: 'hidden' as const,
            }}
          >
            <code
              style={{
                background: 'transparent',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {codeContent}
            </code>
          </pre>
        </div>
      )
    }

    return (
      <div
        className={cn(
          'relative group rounded-xl my-2 bg-[hsl(var(--code-bg))] border border-[hsl(var(--code-border))] text-[hsl(var(--code-text))] rs-terminal pt-8 max-w-full min-w-0',
        )}
        style={{
          maxWidth: '100%',
          overflowX: 'hidden' as const,
          wordBreak: 'break-word' as const,
        }}
      >
        <div className="absolute left-0 right-0 top-0 h-7 px-3 flex items-center gap-2 border-b border-[hsl(var(--code-border))] bg-[hsl(var(--code-header))/0.85]">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
          {!isPlain && <span className="ml-2 text-[11px] text-muted-foreground">{normalized}</span>}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-6 w-6 z-10 text-muted-foreground opacity-90 hover:opacity-100"
            onClick={() => handleCopyCode(codeContent)}
            title="复制代码"
            aria-label="复制代码"
          >
            {copiedCode === codeContent ? (
              <div className="h-3 w-3 bg-green-500 rounded" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>

        <SyntaxHighlighter
          style={oneDark}
          language={isPlain ? (undefined as any) : normalized}
          PreTag="pre"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: 'transparent',
            padding: '12px 14px 14px 14px',
            overflowX: 'hidden' as const,
            width: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
          codeTagProps={{
            style: { background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
          }}
          showLineNumbers={false}
          wrapLongLines
          className={cn('text-sm', isStreaming && 'typing-cursor')}
        >
          {codeContent}
        </SyntaxHighlighter>
      </div>
    )
  }

  const renderFallback = () => {
    if (!fallback) return null

    return (
      <div
        className={cn(
          'markdown-body prose prose-zinc dark:prose-invert max-w-none break-words',
          '[&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:whitespace-pre-wrap',
          (isStreaming || isRendering) && 'typing-cursor',
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkKatexTokenizer, [remarkMath, defaultRemarkMathOptions], remarkGfm]}
          rehypePlugins={rehypeKatexPlugin ? [rehypeKatexPlugin] : undefined}
          components={{
            pre({ children }: any) {
              return <>{children}</>
            },
            code({ inline, className, children, ...props }: any) {
              const match = /language-([\w+-]+)/.exec(className || '')
              const rawLang = match ? match[1] : ''
              const codeContent = String(children).replace(/\n$/, '')
              const isBlock = inline === false || Boolean(match) || codeContent.includes('\n')

              if (isBlock && codeContent) {
                return <TerminalCodeBlock code={codeContent} language={rawLang} />
              }

              return (
                <code
                  className={cn(
                    'px-1.5 py-0.5 rounded text-sm font-mono bg-muted/30 break-words whitespace-pre-wrap',
                    isStreaming && 'typing-cursor',
                  )}
                  {...props}
                >
                  {children}
                </code>
              )
            },
            // 处理图片，支持 data URL 和普通 URL
            img({ src, alt, ...props }: any) {
              if (!src) return null
              // 对于 data URL 或普通 URL，使用原生 img 标签
              return (
                <img
                  src={src}
                  alt={alt || 'Generated Image'}
                  className="max-w-full h-auto rounded-lg my-2"
                  loading="lazy"
                  {...props}
                />
              )
            },
          }}
        >
          {preparedFallback}
        </ReactMarkdown>
      </div>
    )
  }

  if (trimmedHtml.length === 0) {
    if (preferPlainStreamingFallback) {
      return (
        <pre
          className={cn(
            'my-0 max-w-full whitespace-pre-wrap break-words rounded-lg bg-muted/20 px-3 py-2 text-sm',
            (isStreaming || isRendering) && 'typing-cursor',
          )}
        >
          {fallback}
        </pre>
      )
    }
    return renderFallback()
  }

  if (codeMarkerParts) {
    return (
      <div
        className={cn(
          'markdown-body prose prose-zinc dark:prose-invert max-w-none break-words',
          isStreaming || isRendering ? 'markdown-body--pending' : null,
        )}
      >
        {codeMarkerParts.map((part, idx) => {
          if (part.type === 'html') {
            const htmlPart = part.html.trim()
            if (!htmlPart) return null
            return <div key={`html-${idx}`} dangerouslySetInnerHTML={{ __html: htmlPart }} />
          }
          return <TerminalCodeBlock key={`code-${idx}`} code={part.code} language={part.language} />
        })}
      </div>
    )
  }

  if (fallbackHasCodeBlocks) {
    return renderFallback()
  }

  return (
    <div
      className={cn(
        'markdown-body prose prose-zinc dark:prose-invert max-w-none break-words',
        isStreaming || isRendering ? 'markdown-body--pending' : null,
      )}
      dangerouslySetInnerHTML={{ __html: trimmedHtml }}
    />
  )
})
