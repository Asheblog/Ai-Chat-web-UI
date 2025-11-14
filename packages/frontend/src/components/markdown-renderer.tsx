'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from '@/components/ui/button'
import { Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ensureKatexResources } from '@/lib/load-katex'

const mathLikePattern =
  /(\$\$?|\\\[|\\\(|\\begin\{|\\end\{|\\ce\{|\\pu\{|\\frac|\\sum|\\int|\\sqrt|\\alpha|\\beta|\\gamma)/i

interface MarkdownRendererProps {
  html?: string | null
  fallback: string
  isStreaming?: boolean
  isRendering?: boolean
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

  const needsMathSupport = useMemo(() => {
    if (trimmedHtml && /katex/i.test(trimmedHtml)) {
      return true
    }
    if (!fallback) {
      return false
    }
    return mathLikePattern.test(fallback)
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

  const renderFallback = () => {
    if (!fallback) return null

    return (
      <div
        className={cn(
          'markdown-body prose prose-zinc dark:prose-invert max-w-none break-words',
          '[&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:whitespace-pre-wrap',
          (isStreaming || isRendering) && 'typing-cursor'
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={rehypeKatexPlugin ? [rehypeKatexPlugin] : undefined}
          components={{
            pre({ children }: any) {
              return <pre style={{ display: 'contents' }}>{children}</pre>
            },
            code({ inline, className, children, ...props }: any) {
              const responsiveContainerStyle = {
                maxWidth: '100%',
                overflowX: 'hidden' as const,
                wordBreak: 'break-word' as const,
              }
              const match = /language-([\w+-]+)/.exec(className || '')
              const rawLang = match ? match[1] : ''
              const lang0 = (rawLang || '').toLowerCase()
              const language = ['bash', 'sh', 'shell', 'zsh', 'console'].includes(lang0) ? 'bash' : lang0
              const isPlain = !language || ['plaintext', 'text', 'txt', 'nohighlight'].includes(language)
              const codeContent = String(children).replace(/\n$/, '')

              if (!inline && codeContent) {
                const tooLargeForHL =
                  isStreaming || codeContent.length > 20000 || codeContent.split('\n').length > 400
                const isSingleLine = !codeContent.includes('\n')
                const isShortPlain = isPlain && isSingleLine && codeContent.trim().length <= 80
                if (isShortPlain) {
                  return (
                    <code
                      className={cn(
                        'px-1.5 py-0.5 rounded text-sm font-mono bg-muted/30',
                        isStreaming && 'typing-cursor'
                      )}
                      {...props}
                    >
                      {codeContent}
                    </code>
                  )
                }
                if (tooLargeForHL) {
                  return (
                    <div
                      className={cn(
                        'relative group rounded-xl my-2 bg-[#0d1117] border border-[#22262e] text-slate-200 rs-terminal pt-8 max-w-full min-w-0'
                      )}
                      style={responsiveContainerStyle}
                    >
                      <div className="absolute left-0 right-0 top-0 h-7 px-3 flex items-center gap-2 border-b border-[#22262e] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.15))]">
                        <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                        <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                        <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                        {!isPlain && <span className="ml-2 text-[11px] text-slate-400">{language}</span>}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-auto h-6 w-6 z-10 opacity-90 hover:opacity-100 text-slate-400"
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
                          color: '#e6edf3',
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
                      'relative group rounded-xl my-2 bg-[#0d1117] border border-[#22262e] text-slate-200 rs-terminal pt-8 max-w-full min-w-0'
                    )}
                    style={responsiveContainerStyle}
                  >
                    <div className="absolute left-0 right-0 top-0 h-7 px-3 flex items-center gap-2 border-b border-[#22262e] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.15))]">
                      <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                      <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                      <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                      {!isPlain && <span className="ml-2 text-[11px] text-slate-400">{language}</span>}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-6 w-6 z-10 opacity-90 hover:opacity-100 text-slate-400"
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
                      language={isPlain ? (undefined as any) : language}
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
                      {...props}
                    >
                      {codeContent}
                    </SyntaxHighlighter>
                  </div>
                )
              }

              return (
                <code
                  className={cn(
                    'px-1.5 py-0.5 rounded text-sm font-mono bg-muted/30 break-words whitespace-pre-wrap',
                    isStreaming && 'typing-cursor'
                  )}
                  {...props}
                >
                  {children}
                </code>
              )
            },
          }}
        >
          {fallback}
        </ReactMarkdown>
      </div>
    )
  }

  if (trimmedHtml.length === 0) {
    return renderFallback()
  }

  return (
    <div
      className={cn(
        'markdown-body prose prose-zinc dark:prose-invert max-w-none break-words',
        isStreaming || isRendering ? 'markdown-body--pending' : null
      )}
      dangerouslySetInnerHTML={{ __html: trimmedHtml }}
    />
  )
})
