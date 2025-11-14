let katexResourcePromise: Promise<{ rehypeKatex: any }> | null = null

export const ensureKatexResources = async () => {
  if (katexResourcePromise) {
    return katexResourcePromise
  }

  if (typeof window === 'undefined') {
    return { rehypeKatex: null }
  }

  katexResourcePromise = (async () => {
    await Promise.all([import('katex/dist/katex.min.css'), import('katex'), import('katex/contrib/mhchem')])
    const rehypeKatexModule = await import('rehype-katex')
    return {
      rehypeKatex: rehypeKatexModule.default ?? rehypeKatexModule,
    }
  })()

  return katexResourcePromise
}
