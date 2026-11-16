import { classifyChallenge } from '../challenge'

const article = (body: string) => `<!DOCTYPE html><html><head><title>How Cloudflare CAPTCHA works</title></head>
<body><nav><a href="/">Home</a><a href="/blog">Blog</a></nav>
<article><h1>How Cloudflare CAPTCHA works</h1>
${body}
</article><aside>related links</aside></body></html>`

describe('classifyChallenge', () => {
  test('keeps a real article that merely mentions Cloudflare and CAPTCHA', () => {
    const html = article(
      '<p>Cloudflare 的 CAPTCHA 是常见的反自动访问机制。本文解释它的验证流程、误判来源与站点配置方式。</p>'.repeat(6) +
      '<p>真正的人工验证页通常只有一段提示、没有正文段落，并且挂载 challenge-platform 脚本。</p>'.repeat(4),
    )
    const verdict = classifyChallenge({ html, status: 200, url: 'https://example.com/blog/cloudflare-captcha' })
    expect(verdict.isChallenge).toBe(false)
    expect(verdict.reason).toBeUndefined()
  })

  test('detects a structural Cloudflare interstitial', () => {
    const html = `<html><head><title>Just a moment...</title></head>
      <body><h1>Just a moment...</h1><p>Checking your browser before accessing example.com.</p>
      <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></body></html>`
    const verdict = classifyChallenge({ html, status: 200, url: 'https://example.com/news' })
    expect(verdict.isChallenge).toBe(true)
    expect(verdict.reason).toBe('structure')
    expect(verdict.signals).toEqual(expect.arrayContaining(['challenge-platform']))
  })

  test('detects a thin enable-javascript page by keyword plus missing body', () => {
    const html = '<html><body>Please enable JavaScript to continue</body></html>'
    const verdict = classifyChallenge({ html, status: 200, url: 'https://example.com/challenge' })
    expect(verdict.isChallenge).toBe(true)
    expect(verdict.reason).toBe('thin-content')
  })

  test('detects the 403 attention-required challenge form', () => {
    const html = `<html><head><title>Attention Required! | Cloudflare</title></head><body>
      <form id="challenge-form" action="/cdn-cgi/l/chk_captcha"><div class="cf-error-details">Please complete the CAPTCHA</div></form>
      </body></html>`
    const verdict = classifyChallenge({ html, status: 403, url: 'https://example.com/blocked' })
    expect(verdict.isChallenge).toBe(true)
  })

  test('does not treat a login wall as an anti-bot challenge', () => {
    const html = `<html><head><title>Sign in</title></head><body><main>
      <h1>Sign in to continue</h1><p>Please log in to read the full article.</p>
      <form><input name="email" /><input name="password" type="password" /></form></main></body></html>`
    const verdict = classifyChallenge({ html, status: 200, url: 'https://example.com/protected' })
    expect(verdict.isChallenge).toBe(false)
  })

  test('treats an empty document as not-a-challenge', () => {
    const verdict = classifyChallenge({ html: '', status: 200, url: 'https://example.com/empty' })
    expect(verdict.isChallenge).toBe(false)
  })

  test('keeps a real article that only carries the Cloudflare challenge-platform script', () => {
    const html = article(
      '<p>' + '正文段落，说明正常页面也会加载 challenge-platform 脚本。'.repeat(4) + '</p>' +
      '<p>' + '第二段继续说明站点注入的脚本不影响正文可读性判断。'.repeat(4) + '</p>' +
      '<p>' + '第三段用于确认段落数量达到正文标准。'.repeat(4) + '</p>',
    ).replace('</head>', '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head>')
    const verdict = classifyChallenge({ html, status: 200, url: 'https://example.com/normal-cloudflare' })
    expect(verdict.isChallenge).toBe(false)
    expect(verdict.signals).toContain('challenge-platform')
  })

  test('detects a Chinese verification interstitial', () => {
    const html = `<html><head><title>请稍候…</title></head><body>
      <div class="cf-browser-verification"><p>请验证您是人类，正在检查浏览器。</p>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></div></body></html>`
    const verdict = classifyChallenge({ html, status: 503, url: 'https://example.com/zh' })
    expect(verdict.isChallenge).toBe(true)
    expect(verdict.reason).toBe('structure')
  })

  test('does not classify a long page with a captcha word in a comment', () => {
    const html = article('<p>' + '正文内容。'.repeat(200) + '</p>')
    const verdict = classifyChallenge({ html, status: 200, url: 'https://example.com/long' })
    expect(verdict.isChallenge).toBe(false)
  })
})
