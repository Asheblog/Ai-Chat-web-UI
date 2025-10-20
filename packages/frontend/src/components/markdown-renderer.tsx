'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
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
  const isDark = resolvedTheme === 'dark'

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (error) {
      console.error('Failed to copy code:', error)
    }
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // 自定义代码块渲染
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const language = match ? match[1] : ''
          const codeContent = String(children).replace(/\n$/, '')

          if (!inline && codeContent) {
            return (
              <div className="relative group">
                <div className="flex items-center justify-between bg-muted px-4 py-2 text-sm text-muted-foreground border-b">
                  <span>{language || 'plaintext'}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleCopyCode(codeContent)}
                  >
                    {copiedCode === codeContent ? (
                      <div className="h-3 w-3 bg-green-500 rounded" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                <SyntaxHighlighter
                  style={isDark ? oneDark : oneLight}
                  language={language}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    background: isDark ? 'hsl(var(--muted))' : 'hsl(var(--muted))',
                  }}
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
                "px-1.5 py-0.5 rounded text-sm font-mono bg-muted",
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
            <ul className="list-disc list-inside mb-4 space-y-1">
              {children}
            </ul>
          )
        },

        ol({ children }) {
          return (
            <ol className="list-decimal list-inside mb-4 space-y-1">
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
  )
}