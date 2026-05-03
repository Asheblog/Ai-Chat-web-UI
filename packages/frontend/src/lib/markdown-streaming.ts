const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

const isEscaped = (value: string, index: number) => {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

const countDisplayMathDelimiters = (value: string) => {
  let count = 0
  for (let i = 0; i < value.length - 1; i += 1) {
    if (value[i] !== '$' || value[i + 1] !== '$' || isEscaped(value, i)) continue
    count += 1
    i += 1
  }
  return count
}

export const closeOpenMarkdownBlocks = (markdown: string) => {
  if (!markdown) return markdown

  const lines = markdown.split('\n')
  let openFence: string | null = null

  for (const line of lines) {
    const match = line.match(FENCE_RE)
    if (!match) continue
    const fence = match[1]
    const marker = fence[0]
    if (!openFence) {
      openFence = fence
      continue
    }
    if (openFence[0] === marker && fence.length >= openFence.length) {
      openFence = null
    }
  }

  let next = markdown
  if (openFence) {
    next += `${next.endsWith('\n') ? '' : '\n'}${openFence}`
  }

  const displayMathCount = countDisplayMathDelimiters(next)
  if (displayMathCount % 2 !== 0) {
    next += `${next.endsWith('\n') ? '' : '\n'}$$`
  }

  return next
}
