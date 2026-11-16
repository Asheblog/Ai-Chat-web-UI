import {
  assessContentQuality,
  countReadableUnits,
  extractDocumentFromHtml,
} from '../html-document'

const articlePage = (paragraphs: string[], extraHead = '') => `<!DOCTYPE html><html lang="zh-CN"><head>
  <title>页面标题</title>${extraHead}</head><body>
  <nav><a href="/">首页</a><a href="/news">新闻</a></nav>
  <article><h1>文章标题</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</article>
  <aside><a href="/ad">广告</a></aside></body></html>`

describe('countReadableUnits', () => {
  test('counts CJK characters as readable units', () => {
    expect(countReadableUnits('深度研究')).toBe(4)
  })

  test('counts latin words as units and ignores whitespace', () => {
    expect(countReadableUnits('hello world  again')).toBe(3)
  })

  test('counts mixed CJK and latin text', () => {
    expect(countReadableUnits('AI 报告 2026')).toBe(4)
  })
})

describe('extractDocumentFromHtml', () => {
  test('prefers a substantial JSON-LD articleBody before generic extraction', () => {
    const body = '第一段：这是结构化数据中的正文，包含足够的细节用于验证语义提取优先，并说明为什么页面里的语义标记比通用可读性算法更可靠。\n\n第二段：继续补充内容，把长度推到通用阈值之上，同时保留段落结构，避免被误判为短提示或登录墙。\n\n第三段：结尾再补一句，让结构化正文明显长于页面导航文本。'
    const html = articlePage([], `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Article',
      headline: 'JSON 标题',
      articleBody: body,
      datePublished: '2026-11-16T08:00:00Z',
    })}</script>`)
    const doc = extractDocumentFromHtml(html, 'https://example.com/a')
    expect(doc).not.toBeNull()
    expect(doc?.title).toBe('JSON 标题')
    expect(doc?.contentKind).toBe('article')
    expect(doc?.text).toContain('第一段：这是结构化数据中的正文')
    expect(doc?.publishedTime).toBe('2026-11-16T08:00:00Z')
  })

  test('extracts a normal article with title, byline metadata and quality signals', () => {
    const html = articlePage(
      [
        '第一段正文：用于验证语义正文提取，内容长度足够通过最小阈值。',
        '第二段正文：继续补充信息，保证段落数量和可读文本都达到要求。',
        '第三段正文：文章不应该因为页面导航链接而降低质量判断。',
        '第四段正文：到这里已经有了足够的正文内容。',
        '第五段正文：最后一段用于确认质量信号稳定。',
      ],
      '<meta property="article:published_time" content="2026-11-16T09:00:00Z" />',
    )
    const doc = extractDocumentFromHtml(html, 'https://example.com/article')
    expect(doc?.contentKind).toBe('article')
    expect(doc?.text.length).toBeGreaterThan(100)
    expect(doc?.quality.isThin).toBe(false)
    expect(doc?.quality.navigationRatio).toBeLessThan(0.4)
    expect(doc?.quality.paragraphCount).toBeGreaterThanOrEqual(3)
    expect(doc?.maxLengthTruncated).toBe(false)
  })

  test('keeps a short Chinese news item without applying an English word count', () => {
    const html = articlePage([
      '短讯：今日上午，研究团队发布了新的网页正文提取方案，重点解决中文短新闻被误判为空内容的问题。',
      '方案保留了段落、列表与表格信息，并在正文不足时才启动浏览器渲染。',
    ])
    const doc = extractDocumentFromHtml(html, 'https://example.com/news/short')
    expect(doc?.text.length).toBeGreaterThan(60)
    expect(doc?.quality.isThin).toBe(false)
    expect(doc?.wordCount).toBeGreaterThanOrEqual(60)
  })

  test('returns structured list content for a listing page', () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      `<li><a href="/item/${index + 1}">条目 ${index + 1}</a><span>${(index + 1) * 1.5} 元</span></li>`).join('')
    const html = `<html><body><main><h1>行情列表</h1><ul>${items}</ul></main></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://example.com/list')
    expect(doc).not.toBeNull()
    expect(['listing', 'structured']).toContain(doc?.contentKind)
    expect(doc?.text).toContain('条目 3')
    expect(doc?.text).toContain('4.5 元')
    expect(doc?.text).toContain('https://example.com/item/3')
    expect(doc?.quality.isThin).toBe(false)
  })

  test('prefers a short usable article over a pure-link recommendation list', () => {
    const articleText =
      '财联社11月9日电，市场早盘冲高回落，创业板指此前一度涨超1.5%。沪深两市半日成交额1.01万亿，' +
      '较上个交易日缩量1116亿。全市场超2600只个股上涨。盘面上，煤炭板块走强，郑州煤电、安泰集团涨停；' +
      'PCB概念震荡拉升，超声电子、奥士康涨停；机器人华培动力、日盈电子、金固股份涨停。' +
      '下跌方面，光伏概念高开低走，阳光电源、隆基绿能等纷纷下挫。截至收盘，沪指涨0.46%，深成指涨0.27%，' +
      '创业板指涨0.56%。'
    const links = Array.from({ length: 8 }, (_, index) =>
      `<li><a href="https://news.example.com/a/${index}.html">推荐新闻标题 ${index}</a></li>`).join('')
    const html = `<!DOCTYPE html><html><head><title>午评</title></head><body>
      <main><article><p>${articleText}</p></article></main>
      <div><ul>${links}</ul></div>
      </body></html>`
    const doc = extractDocumentFromHtml(html, 'https://finance.example.com/a/1.html')
    expect(doc?.contentKind).toBe('article')
    expect(doc?.text).toContain('财联社11月9日电')
    expect(doc?.text).toContain('创业板指')
    expect(doc?.text).not.toContain('推荐新闻标题 0')
    expect(doc?.text.length).toBeLessThan(600)
  })

  test('does not turn a login/menu/copyright link list into structured content', () => {
    const items = [
      '<li>登录退出</li>',
      '<li><a href="https://gu.example.com/portfolio">腾讯自选股</a></li>',
      '<li><a href="https://gu.example.com/data">数据中心</a></li>',
      '<li><a href="https://gu.example.com/hk">港股创业板</a></li>',
      '<li><a href="https://gu.example.com/us">美股科技股</a></li>',
      '<li><a href="https://gu.example.com/fx">所有汇率</a></li>',
      '<li>联系我们：support@example.com</li>',
      '<li><a href="https://gu.example.com/terms">服务条款</a></li>',
      '<li><a href="https://gu.example.com/about">关于腾讯</a></li>',
    ].join('')
    const html = `<html><body><div><ul>${items}</ul></div></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://gu.example.com/')
    expect(doc === null || doc.contentKind !== 'structured').toBe(true)
  })

  test('marks a multi-news preview page as structured while keeping the preview text', () => {
    const item = (index: number) => `<div>
      <h3>新世界發展最新新聞标题 ${index}</h3>
      <p>摘要内容第 ${index} 条，说明供股与资本重组计划对股价的影响，正文保留用于预览。该条摘要继续展开细节，描述折让幅度、认购价与市值比例，以及市场对摊薄的反应；投资者关注复牌后的价格发现过程与后续融资安排。</p>
      <span>阿斯達克 10:${String(index + 10).padStart(2, '0')}</span>
    </div>`
    const html = `<html><body><main><h1>新世界發展 (00017) 最新新聞</h1>${Array.from({ length: 6 }, (_, i) => item(i)).join('')}</main></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://www.example.com/hk/stock/00017-HK/news')
    expect(doc?.contentKind).toBe('structured')
    expect(doc?.text).toContain('新世界發展最新新聞标题 0')
    expect(doc?.text).toContain('摘要内容第 5 条')
    expect(doc?.text.includes('https://')).toBe(false)
  })

  test('keeps a single 1100-char prose article as article', () => {
    const paragraph =
      '这是一篇单篇散文式财经文章，讨论利率路径、通胀数据与资产配置之间的关系，' +
      '内容连续展开，没有重复的新闻条目结构，也没有列表时间戳。'
    const text = Array.from({ length: 12 }, (_, index) => paragraph + '第' + index + '段继续补充论述与数据解读，保持连续散文结构。').join('')
    const html = `<html><body><article><h1>单篇分析</h1><p>${text}</p></article></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://example.com/analysis')
    expect(doc?.contentKind).toBe('article')
    expect(doc?.text.length).toBeGreaterThan(1000)
  })

  test('keeps table rows and values as structured text', () => {
    const html = `<html><body><main><h1>价格表</h1><table>
      <tr><th>名称</th><th>价格</th><th>涨跌</th></tr>
      <tr><td><a href="/quote/aapl">苹果</a></td><td>3.50</td><td>+1.2%</td></tr>
      <tr><td>香蕉</td><td>2.10</td><td>-0.4%</td></tr>
      <tr><td>橙子</td><td>4.80</td><td>+0.9%</td></tr>
      <tr><td>葡萄</td><td>8.60</td><td>+2.1%</td></tr>
    </table></main></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://example.com/table')
    expect(doc?.contentKind).toBe('structured')
    expect(doc?.text).toContain('苹果')
    expect(doc?.text).toContain('3.50')
    expect(doc?.text).toContain('+1.2%')
    expect(doc?.text).toContain('https://example.com/quote/aapl')
    expect(doc?.quality.isThin).toBe(false)
  })

  test('marks a login wall instead of pretending it is article content', () => {
    const html = `<html><body><main><h1>Sign in</h1>
      <p>Sign in to continue reading this article.</p>
      <form><input name="email" /></form></main></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://example.com/protected')
    expect(doc?.quality.isLoginWall).toBe(true)
    expect(doc?.quality.isThin).toBe(true)
  })

  test('marks a deleted-article notice', () => {
    const html = `<html><body><main><h1>页面提示</h1>
      <p>该文章已被删除，或仅对订阅用户可见。</p></main></body></html>`
    const doc = extractDocumentFromHtml(html, 'https://example.com/deleted')
    expect(doc?.quality.isDeletedNotice).toBe(true)
  })

  test('returns null for a navigation-only shell', () => {
    const links = Array.from({ length: 20 }, (_, index) => `<a href="/p/${index}">栏目${index}</a>`).join('')
    const html = `<html><body><nav>${links}</nav></body></html>`
    expect(extractDocumentFromHtml(html, 'https://example.com/nav')).toBeNull()
  })

  test('truncates long content with an explicit marker', () => {
    const long = '这是一段很长的正文。'.repeat(40)
    const html = articlePage([long, long])
    const doc = extractDocumentFromHtml(html, 'https://example.com/long', { maxContentLength: 300 })
    expect(doc?.maxLengthTruncated).toBe(true)
    expect(doc?.text.length).toBeLessThanOrEqual(340)
  })

  test('collects allowlisted images and drops private hosts', () => {
    const html = articlePage(
      ['第一段正文内容足够长，用来验证图片证据提取。', '第二段继续补充正文内容，保证提取稳定。'],
      '<meta property="og:image" content="/cover.jpg" />',
    ).replace('</article>', '<img src="/content.png" alt="配图" width="640" height="360" /></article>')
    const doc = extractDocumentFromHtml(html.replace('/cover.jpg', 'http://127.0.0.1/cover.jpg'), 'https://example.com/p')
    expect(doc?.images.every((image) => !image.url.includes('127.0.0.1'))).toBe(true)
    expect(doc?.images.some((image) => image.url === 'https://example.com/content.png')).toBe(true)
  })
})

describe('assessContentQuality', () => {
  test('scores link-heavy navigation text as low quality', () => {
    const html = '<nav>' + Array.from({ length: 30 }, () => '<a href="/x">链接文字很长很长</a>').join('') + '</nav>'
    const quality = assessContentQuality('链接文字很长很长'.repeat(30), html)
    expect(quality.navigationRatio).toBeGreaterThan(0.5)
    expect(quality.linkDensity).toBeGreaterThan(0.2)
  })

  test('treats three substantive paragraphs as readable', () => {
    const text = '第一段内容足够长，用于质量判断。\n\n第二段内容足够长，用于质量判断。\n\n第三段内容足够长，用于质量判断。'
    const quality = assessContentQuality(text, '<article><p>a</p><p>b</p><p>c</p></article>')
    expect(quality.isThin).toBe(false)
    expect(quality.paragraphCount).toBe(3)
  })
})