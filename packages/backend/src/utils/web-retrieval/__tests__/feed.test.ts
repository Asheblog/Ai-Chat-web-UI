import { discoverFeedCandidates } from '../feed'

describe('discoverFeedCandidates', () => {
  test('reads declared rss and atom links and resolves relative urls', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml" />
      <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml" />
      <link rel="stylesheet" href="/style.css" />
    </head></html>`
    const candidates = discoverFeedCandidates(html, 'https://example.com/news/article')
    expect(candidates).toEqual([
      { url: 'https://example.com/feed.xml', declared: true },
      { url: 'https://example.com/atom.xml', declared: true },
    ])
  })

  test('deduplicates repeated declarations', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed/" />
      <link rel="alternate" type="application/rss+xml" href="/feed/" />`
    expect(discoverFeedCandidates(html, 'https://example.com/a')).toHaveLength(1)
  })

  test('never guesses feed paths without a declaration', () => {
    const candidates = discoverFeedCandidates('<html><body>no feed</body></html>', 'https://example.com/a/b')
    expect(candidates).toEqual([])
  })

  test('returns only the declared candidates', () => {
    const html = '<link rel="alternate" type="application/rss+xml" href="/feed.xml" />'
    const candidates = discoverFeedCandidates(html, 'https://example.com/a')
    expect(candidates).toEqual([{ url: 'https://example.com/feed.xml', declared: true }])
  })

  test('bounds declared candidates', () => {
    const html = Array.from({ length: 6 }, (_, index) =>
      `<link rel="alternate" type="application/rss+xml" href="/feed/${index}.xml" />`).join('')
    expect(discoverFeedCandidates(html, 'https://example.com/a').length).toBe(3)
  })

  test('returns no candidates for an invalid base url', () => {
    expect(discoverFeedCandidates('<link rel="alternate" type="application/rss+xml" href="/f" />', 'not a url')).toEqual([])
  })
})
