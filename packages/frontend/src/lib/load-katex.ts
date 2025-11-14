let katexResourcePromise: Promise<{ rehypeKatex: any }> | null = null
let katexCssPromise: Promise<void> | null = null

const ensureKatexCss = () => {
  if (typeof document === 'undefined') {
    return Promise.resolve()
  }
  if (katexCssPromise) {
    return katexCssPromise
  }
  const existing = document.querySelector('link[data-katex-css]')
  if (existing) {
    katexCssPromise = Promise.resolve()
    return katexCssPromise
  }
  katexCssPromise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css'
    link.dataset.katexCss = 'true'
    link.onload = () => resolve()
    link.onerror = () => reject(new Error('KaTeX CSS 加载失败'))
    document.head.appendChild(link)
  })
  return katexCssPromise
}

export const ensureKatexResources = async () => {
  if (katexResourcePromise) {
    await ensureKatexCss()
    return katexResourcePromise
  }

  if (typeof window === 'undefined') {
    return { rehypeKatex: null }
  }

  katexResourcePromise = (async () => {
    await ensureKatexCss()
    await Promise.all([import('katex'), import('katex/contrib/mhchem')])
    const rehypeKatexModule = await import('rehype-katex')
    return {
      rehypeKatex: rehypeKatexModule.default ?? rehypeKatexModule,
    }
  })()

  return katexResourcePromise
}
