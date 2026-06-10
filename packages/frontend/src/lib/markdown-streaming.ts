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

/**
 * 统计 $$ 数量，跳过代码块（围栏）内的 $$。
 * 避免将 shell 变量（echo $$）、JSON 字符串（"$$100"）等误判为数学分隔符。
 */
const countDisplayMathDelimitersOutsideFences = (value: string) => {
  let count = 0
  let inFence = false
  let fenceChar = ''
  const lines = value.split('\n')

  for (const line of lines) {
    const match = line.match(FENCE_RE)
    if (match) {
      const fence = match[1]
      const marker = fence[0]
      if (!inFence) {
        inFence = true
        fenceChar = marker
        continue
      }
      if (marker === fenceChar && fence.length >= 3) {
        inFence = false
        fenceChar = ''
        // 围栏行本身可能有 $$（如 ```markdown 注释），跳过
        continue
      }
    }

    if (inFence) continue

    // 跳过行内代码中的 $$（用反引号包裹）
    let inInlineCode = false
    let backtickCount = 0
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '`') {
        backtickCount += 1
        continue
      }
      if (backtickCount > 0) {
        inInlineCode = !inInlineCode
        backtickCount = 0
        continue
      }
      if (inInlineCode) continue

      if (ch === '$' && line[i + 1] === '$' && !isEscaped(line, i)) {
        count += 1
        i += 1
      }
    }
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

  const displayMathCount = countDisplayMathDelimitersOutsideFences(next)
  if (displayMathCount % 2 !== 0) {
    next += `${next.endsWith('\n') ? '' : '\n'}$$`
  }

  return next
}
