'use client'

import { memo, useEffect, useState } from 'react'
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const languages: Record<string, () => Promise<{ default: unknown }>> = {
  javascript: () => import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
  typescript: () => import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
  jsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
  tsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
  python: () => import('react-syntax-highlighter/dist/esm/languages/prism/python'),
  bash: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
  json: () => import('react-syntax-highlighter/dist/esm/languages/prism/json'),
  css: () => import('react-syntax-highlighter/dist/esm/languages/prism/css'),
  sql: () => import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
  markup: () => import('react-syntax-highlighter/dist/esm/languages/prism/markup'),
  markdown: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
  java: () => import('react-syntax-highlighter/dist/esm/languages/prism/java'),
  c: () => import('react-syntax-highlighter/dist/esm/languages/prism/c'),
  cpp: () => import('react-syntax-highlighter/dist/esm/languages/prism/cpp'),
  csharp: () => import('react-syntax-highlighter/dist/esm/languages/prism/csharp'),
  go: () => import('react-syntax-highlighter/dist/esm/languages/prism/go'),
  rust: () => import('react-syntax-highlighter/dist/esm/languages/prism/rust'),
  yaml: () => import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
}
const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml', html: 'markup', xml: 'markup', md: 'markdown', cs: 'csharp' }
const loaded = new Map<string, Promise<void>>()
const codeStyle: SyntaxHighlighterProps['customStyle'] = { margin: 0, background: 'transparent', padding: '12px 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }

export default memo(function HighlightedCode({ code, language }: { code: string; language: string }) {
  const normalized = aliases[language] ?? language
  const [ready, setReady] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const loader = languages[normalized]
    if (!loader) return
    if (!loaded.has(normalized)) loaded.set(normalized, loader().then((module) => {
      SyntaxHighlighter.registerLanguage(normalized, module.default)
    }).catch(() => { loaded.delete(normalized); throw new Error('language-load-failed') }))
    void loaded.get(normalized)!.then(() => { if (active) setReady(normalized) }).catch(() => {})
    return () => { active = false }
  }, [normalized])
  if (ready !== normalized) return <pre className='m-0 whitespace-pre-wrap break-words px-3 py-3 text-sm'><code>{code}</code></pre>
  return <SyntaxHighlighter style={oneDark} language={normalized} PreTag='pre' wrapLongLines showLineNumbers={false}
    customStyle={codeStyle}
    codeTagProps={{ style: { background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }} className='text-sm'>{code}</SyntaxHighlighter>
})
