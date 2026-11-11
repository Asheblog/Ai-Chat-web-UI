/**
 * 数学公式探测：Worker 只在正文真的含公式时才加载 KaTeX。
 *
 * KaTeX 及其 rehype 插件体积远大于 Markdown 管线本身，静态塞进 Worker 入口
 * 会把 ready 握手拖到数秒（弱网直接超过初始化预算）。这里用与
 * @aichat/shared/latex-normalizer 支持的定界符一致的启发式判断，宁可多加载
 * 一次，也不漏掉真正需要公式渲染的正文。
 */

const CODE_FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const ESCAPED_DOLLAR_RE = /\\\$/g

const MATH_PATTERN =
  /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\(|\\\[|\\ce\{|\\pu\{|\\boxed\{|\\begin\{(?:equation|align|aligned|cases|matrix|pmatrix|bmatrix|vmatrix)\}|@@LATEX-(?:INLINE|BLOCK):[A-Za-z0-9_-]+@@/

export const containsMath = (markdown: string): boolean => {
  if (!markdown) return false
  const withoutCode = markdown
    .replace(CODE_FENCE_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(ESCAPED_DOLLAR_RE, ' ')
  return MATH_PATTERN.test(withoutCode)
}
