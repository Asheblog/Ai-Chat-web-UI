'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
  content: string
  isStreaming?: boolean
}

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = true // 终端风：统一使用暗色代码主题

  const handleCopyCode = async (code: string) => {
    // 复制兼容：优先 Clipboard API；失败时降级到隐藏 textarea
    try {
      if (typeof window !== 'undefined' && navigator?.clipboard && (window.isSecureContext ?? true)) {
        await navigator.clipboard.writeText(code)
      } else {
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

  return (
    <div className={cn("prose prose-zinc dark:prose-invert max-w-none")}
    >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // 注意：不再使用 rehype-highlight，避免与 react-syntax-highlighter 重复高亮，
      // 同时防止 children 变为 React 元素导致 String(children) => "[object Object]"。
      rehypePlugins={[]}
      components={{
        // 重要：去掉 ReactMarkdown 默认给代码块包裹的外层 <pre> 的盒模型
        // 使用 display: contents 让它不参与布局，避免出现 “pre(外层) + 我们的容器(内层)” 的双层效果
        pre({ children }: any) {
          return <pre style={{ display: 'contents' }}>{children}</pre>
        },
        // 自定义代码块渲染
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-([\w+-]+)/.exec(className || '')
          const rawLang = match ? match[1] : ''
          const lang0 = (rawLang || '').toLowerCase()
          const language = ['bash','sh','shell','zsh','console'].includes(lang0) ? 'bash' : lang0
          const isPlain = !language || ['plaintext','text','txt','nohighlight'].includes(language)
          const codeContent = String(children).replace(/\n$/, '')

          if (!inline && codeContent) {
            const tooLargeForHL = isStreaming || codeContent.length > 20000 || codeContent.split('\n').length > 400
            // 将短小的纯文本代码块（如仅一行 URL/变量名）自动降级为“行内样式”，
            // 避免生成一整块卡片导致段落被强制换行，贴近 ChatGPT 的排版体验。
            const isSingleLine = !codeContent.includes('\n')
            const isShortPlain = isPlain && isSingleLine && codeContent.trim().length <= 80
            if (isShortPlain) {
              return (
                <code
                  className={cn(
                    "px-1.5 py-0.5 rounded text-sm font-mono bg-muted/30",
                    isStreaming && "typing-cursor"
                  )}
                  {...props}
                >
                  {codeContent}
                </code>
              )
            }
            if (tooLargeForHL) {
              return (
                <div className={cn(
                  "relative group rounded-xl my-2 overflow-hidden bg-[#0d1117] border border-[#22262e] text-slate-200 rs-terminal pt-8"
                )}>
                  <div className="absolute left-0 right-0 top-0 h-7 px-3 flex items-center gap-2 border-b border-[#22262e] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.15))]">
                    <span className="w-3 h-3 rounded-full bg-[#ff5f56]"/>
                    <span className="w-3 h-3 rounded-full bg-[#ffbd2e]"/>
                    <span className="w-3 h-3 rounded-full bg-[#27c93f]"/>
                    {!isPlain && (
                      <span className="ml-2 text-[11px] text-slate-400">{language}</span>
                    )}
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
                  <pre className={cn("m-0 text-sm overflow-x-auto px-3 py-3", isStreaming && "typing-cursor")} style={{ background: 'transparent', color: '#e6edf3', whiteSpace: 'pre' }}>
                    <code style={{ background: 'transparent' }}>{codeContent}</code>
                  </pre>
                </div>
              )
            }
            return (
              <div
                className={cn(
                  "relative group rounded-xl my-2 overflow-hidden bg-[#0d1117] border border-[#22262e] text-slate-200 rs-terminal pt-8"
                )}
              >
                <div className="absolute left-0 right-0 top-0 h-7 px-3 flex items-center gap-2 border-b border-[#22262e] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.15))]">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f56]"/>
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e]"/>
                  <span className="w-3 h-3 rounded-full bg-[#27c93f]"/>
                  {!isPlain && (
                    <span className="ml-2 text-[11px] text-slate-400">{language}</span>
                  )}
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
                  language={isPlain ? undefined as any : language}
                  PreTag="pre"
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    background: 'transparent',
                    padding: '12px 14px 14px 14px',
                    overflowX: 'auto',
                    width: '100%',
                  }}
                  codeTagProps={{ style: { background: 'transparent' } }}
                  showLineNumbers
                  wrapLongLines={false}
                  lineNumberStyle={{ minWidth: '2.5em', paddingRight: '12px', color: '#64748b', opacity: 0.9 }}
                  className={cn(
                    "text-sm",
                    isStreaming && "typing-cursor"
                  )}
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
                "px-1.5 py-0.5 rounded text-sm font-mono bg-muted/30",
                isStreaming && "typing-cursor"
              )}
              {...props}
            >
              {children}
            </code>
          )
        },

        // 自定义标题渲染
        h1({ children }) {
          return (
            <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0">
              {children}
            </h1>
          )
        },

        h2({ children }) {
          return (
            <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0">
              {children}
            </h2>
          )
        },

        h3({ children }) {
          return (
            <h3 className="text-lg font-bold mb-2 mt-4 first:mt-0">
              {children}
            </h3>
          )
        },

        h4({ children }) {
          return (
            <h4 className="text-base font-bold mb-2 mt-3 first:mt-0">
              {children}
            </h4>
          )
        },

        // 自定义段落渲染
        p({ children }) {
          return (
            <p className="mb-4 last:mb-0 leading-7">
              {children}
            </p>
          )
        },

        // 自定义列表渲染
        ul({ children }) {
          return (
            <ul className="list-disc pl-6 my-3 space-y-1">
              {children}
            </ul>
          )
        },

        ol({ children }) {
          return (
            <ol className="list-decimal pl-6 my-3 space-y-1">
              {children}
            </ol>
          )
        },

        li({ children }) {
          return (
            <li className="leading-7">
              {children}
            </li>
          )
        },

        // 自定义引用渲染
        blockquote({ children }) {
          return (
            <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">
              {children}
            </blockquote>
          )
        },

        // 自定义表格渲染
        table({ children }) {
          return (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-border">
                {children}
              </table>
            </div>
          )
        },

        thead({ children }) {
          return (
            <thead className="bg-muted">
              {children}
            </thead>
          )
        },

        th({ children }) {
          return (
            <th className="border border-border px-4 py-2 text-left font-medium">
              {children}
            </th>
          )
        },

        td({ children }) {
          return (
            <td className="border border-border px-4 py-2">
              {children}
            </td>
          )
        },

        // 自定义链接渲染
        a({ children, href }) {
          return (
            <a
              href={href}
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          )
        },

        // 自定义强调渲染
        strong({ children }) {
          return (
            <strong className="font-semibold">
              {children}
            </strong>
          )
        },

        em({ children }) {
          return (
            <em className="italic">
              {children}
            </em>
          )
        },

        // 自定义分隔线渲染
        hr() {
          return (
            <hr className="my-6 border-border" />
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  )
}
