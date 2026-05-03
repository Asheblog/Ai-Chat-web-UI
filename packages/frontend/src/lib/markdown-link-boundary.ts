type HastNode = {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const TRAILING_CJK_RE = /([\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af][\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uff01-\uff1f\u3000-\u303f]*)$/u

const textContent = (node: HastNode | undefined): string => {
  if (!node) return ''
  if (node.type === 'text') return typeof node.value === 'string' ? node.value : ''
  if (!Array.isArray(node.children)) return ''
  return node.children.map(textContent).join('')
}

const isAutolinkLike = (displayText: string, href: string) => {
  const text = displayText.trim()
  if (!text) return false
  if (href === text) return true
  if (href === `http://${text}` || href === `https://${text}`) return true
  return /^(https?:\/\/|www\.)/i.test(text)
}

const splitTrailingLinkedText = (displayText: string, href: string) => {
  if (!isAutolinkLike(displayText, href)) return null
  const match = displayText.match(TRAILING_CJK_RE)
  if (!match || match.index == null) return null

  const trailingText = match[1]
  const linkText = displayText.slice(0, match.index)
  if (!linkText || !/[.:/]/.test(linkText)) return null

  let nextHref = href
  if (nextHref.endsWith(trailingText)) {
    nextHref = nextHref.slice(0, -trailingText.length)
  } else {
    const encodedTrailingText = encodeURI(trailingText)
    if (nextHref.endsWith(encodedTrailingText)) {
      nextHref = nextHref.slice(0, -encodedTrailingText.length)
    }
  }
  if (!nextHref || nextHref === href && displayText === linkText) return null

  return { linkText, trailingText, href: nextHref }
}

const visitChildren = (node: HastNode) => {
  if (!Array.isArray(node.children)) return

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (!child) continue

    if (child.type === 'element' && child.tagName === 'a') {
      const hrefRaw = child.properties?.href
      const href = typeof hrefRaw === 'string' ? hrefRaw : ''
      const displayText = textContent(child)
      const split = splitTrailingLinkedText(displayText, href)
      if (split) {
        child.properties = { ...(child.properties ?? {}), href: split.href }
        child.children = [{ type: 'text', value: split.linkText }]
        node.children.splice(index + 1, 0, { type: 'text', value: split.trailingText })
        index += 1
      }
    }

    visitChildren(child)
  }
}

export const rehypeLinkBoundaries = () => (tree: HastNode) => {
  visitChildren(tree)
}
