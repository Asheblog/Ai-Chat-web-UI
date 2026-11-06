import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'

// Local production build, synthetic API fixtures, and the real packaged Worker.
const require = createRequire(import.meta.url)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || require.resolve('playwright-core'))
const baseURL = process.env.PERF_BASE_URL || 'http://localhost:3100'
const output = path.resolve(process.env.PERF_OUTPUT || 'output/playwright/frontend-performance')
const baseline = process.env.PERF_BASELINE === '1'
const nl = String.fromCharCode(10)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
// Use the installed KaTeX assets for deterministic offline screenshots.
const katexDist = path.join(path.dirname(require.resolve('katex/package.json')), 'dist')
await context.route('https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/**', async route => {
  const asset = new URL(route.request().url()).pathname.split('/dist/')[1]
  assert.ok(asset && !asset.includes('..'), 'unexpected KaTeX asset path')
  await route.fulfill({ body: await readFile(path.join(katexDist, asset)), contentType: asset.endsWith('.css') ? 'text/css' : 'font/woff2' })
})
const errors = [], requests = []
const uncaughtErrors = []
context.on('page', target => target.on('pageerror', error => uncaughtErrors.push(error.message)))
const scriptResponses = new Map()
context.on('response', response => { if (response.url().includes('/_next/static/')) scriptResponses.set(response.url(), response.status()) })
const session = { id: 991, userId: 1, title: '性能回归：中文长文、公式与代码', createdAt: '2026-11-06T00:00:00.000Z', connectionId: 1, modelRawId: 'fixture' }
const fence = String.fromCharCode(96).repeat(3)
const initial = ['# 中文回归验证', '', '正文包含 **加粗**、公式 $E=mc^2$。', '', fence + 'python', 'print("中文代码")', fence].join(nl)
const messages = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, sessionId: 991, stableKey: 'fixture-' + (i + 1), role: i % 2 ? 'assistant' : 'user', content: i === 7 ? initial : i % 2 ? '历史回答 ' + i : '中文历史提问 ' + i, createdAt: '2026-11-06T00:00:00.000Z', streamStatus: 'done' }))
const timestamp = '2026-11-06T00:00:00.000Z'
const shared = { id: 1, sessionId: 991, token: 'performance', title: '中文分享回归', sessionTitle: session.title, messageCount: messages.length, createdAt: timestamp, expiresAt: null, revokedAt: null, messages }
const model = { modelId: 'fixture', modelLabel: '回归模型', connectionId: 1, rawId: 'fixture' }
const battle = { id: 1, battleRunId: 1, token: 'performance', title: 'Battle 中文回归', createdAt: timestamp, expiresAt: null, revokedAt: null, payload: { title: 'Battle 中文回归', mode: 'multi_model', prompt: { text: '请解释中文公式', images: [] }, expectedAnswer: { text: '中文答案', images: [] }, judge: { modelId: 'fixture', modelLabel: '回归裁判', threshold: .8 }, status: 'completed', progress: { totalAttempts: 1, completedAttempts: 1, runningAttempts: 0, pendingAttempts: 0, successAttempts: 1, failedAttempts: 0 }, models: [model], summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: .8, passModelCount: 1, accuracy: 1, modelStats: [{ ...model, passAtK: true, passCount: 1, accuracy: 1, totalAttempts: 1 }] }, results: [{ ...model, questionIndex: 0, attemptIndex: 1, output: initial, reasoning: '中文推理验证', durationMs: 1000, error: null, usage: {}, judgeStatus: 'success', judgePass: true, judgeScore: 1, judgeReason: '验证通过', judgeFallbackUsed: false }], createdAt: timestamp } }
const fixtureServer = !baseline ? createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const data = pathname.includes('/battle/shares/') ? battle : pathname.endsWith('/messages') ? { messages, pagination: { page: 1, limit: 50, total: messages.length, totalPages: 1 } } : shared
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ success: true, data }))
}) : null
if (fixtureServer) await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(Number(process.env.PERF_FIXTURE_PORT || 3102), '127.0.0.1', resolve) })
await context.route('**/api/**', async route => {
  const pathname = new URL(route.request().url()).pathname.slice(4)
  requests.push(pathname)
  let data = {}
  if (pathname === '/auth/actor') data = { actor: { type: 'user', id: 1, username: '性能回归用户', role: 'USER', status: 'ACTIVE' }, quota: null }
  else if (pathname === '/sessions') data = { sessions: [session] }
  else if (pathname === '/sessions/991') data = session
  else if (pathname.endsWith('/messages')) data = { messages, pagination: { page: 1, limit: 20, total: messages.length, totalPages: 1 } }
  else if (pathname === '/catalog/models') data = [{ id: 'fixture', rawId: 'fixture', name: '回归模型', provider: 'openai', channelName: '回归', connectionBaseUrl: '', connectionId: 1 }]
  else if (pathname === '/skills/store') data = { items: [], sources: [] }
  else if (pathname === '/shares' || pathname === '/chat/shares') data = { shares: [] }
  else if (pathname === '/sessions/usage' || pathname.includes('artifacts') || pathname.includes('skills') || pathname.includes('shares')) data = []
  else if (pathname === '/settings/branding') data = { brand_text: 'AIChat' }
  else if (pathname.includes('setup-status')) data = { requires_admin: true }
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
})
await context.addInitScript(() => {
  const NativeWorker = window.Worker
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args)
      window.__workerUrls ??= []
      window.__workerUrls.push(String(args[0]))
      window.__workerEvents ??= []
      this.addEventListener('message', e => window.__workerEvents.push({ type: e.data?.type || 'result', html: Boolean(e.data?.contentHtml), errored: Boolean(e.data?.errored) }))
      this.addEventListener('error', e => window.__workerEvents.push({ type: 'error', message: e.message }))
    }
  }
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text()) })
try {
  const started = Date.now()
  await page.goto(baseURL + '/main/991', { waitUntil: 'networkidle' })
  await page.waitForSelector('.markdown-body', { timeout: 15000 })
  const navigationMs = Date.now() - started
  if (!baseline) {
    await page.waitForFunction(() => window.__workerEvents?.some(e => e.type === 'ready') && window.__workerEvents?.some(e => e.html), null, { timeout: 10000 })
    await page.waitForSelector('.katex', { timeout: 10000 })
    await page.waitForSelector('.rs-terminal', { timeout: 10000 })
    assert.equal(requests.some(p => p.includes('setup-status')), false, 'ordinary user requested setup status')
  }
  const attachStore = target => target.evaluate(() => {
    let webpackRequire
    window.webpackChunk_N_E.push([[Date.now()], {}, r => { webpackRequire = r }])
    for (const [id, factory] of Object.entries(webpackRequire.m)) {
      const source = String(factory)
      if (!source.includes('messageMetas') || !source.includes('clearError')) continue
      try {
        const store = Object.values(webpackRequire(id)).find(value => typeof value?.getState === 'function' && value.getState()?.messageBodies)
        if (store) { window.__perfStore = store; break }
      } catch {}
    }
    if (!window.__perfStore) throw new Error('Chat store not found in application modules')
  })
  await attachStore(page)
  const metrics = await page.evaluate(async () => {
    const store = window.__perfStore
    const text = Array.from({ length: 520 }, (_, i) => '第' + i + '段 中文长正文，用于验证流式更新时阅读与输入是否流畅，内容覆盖持续追加和最终文本完整性。').join(String.fromCharCode(10).repeat(2))
    const key = '8', start = store.getState()
    store.setState({ messageMetas: start.messageMetas.map(m => m.id === 8 ? { ...m, richPayload: null, streamStatus: 'streaming' } : m), messageBodies: { ...start.messageBodies, [key]: { ...start.messageBodies[key], content: text, version: 2 } }, isStreaming: true, activeStreamSessionId: 991 })
    await new Promise(resolve => setTimeout(resolve, 1000))
    const frames = [], longTasks = []
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)))
    observer.observe({ type: 'longtask', buffered: false })
    let active = true, last = performance.now()
    const tick = now => { frames.push(now - last); last = now; if (active) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    for (let i = 0; i < 25; i++) {
      const state = store.getState()
      store.setState({ messageBodies: { ...state.messageBodies, [key]: { ...state.messageBodies[key], content: text + '追加'.repeat(i + 1), version: i + 3 } } })
      await new Promise(resolve => setTimeout(resolve, 48))
    }
    active = false
    observer.disconnect()
    const state = store.getState()
    store.setState({ isStreaming: false, activeStreamSessionId: null, messageMetas: state.messageMetas.map(m => m.id === 8 ? { ...m, streamStatus: 'done' } : m) })
    frames.sort((a, b) => a - b)
    return { characters: text.length, updates: 25, cadenceMs: 48, frameCount: frames.length, frameP95: frames[Math.floor(frames.length * .95)], longTaskCount: longTasks.length, longTaskMax: Math.max(0, ...longTasks) }
  })
  await page.waitForTimeout(1500)
  const cache = await page.evaluate(() => { const s = window.__perfStore.getState(); return { html: Boolean(s.messageRenderCache['8']?.contentHtml), source: s.messageRenderCache['8']?.sourceContent?.length, tailVisible: document.body.textContent.includes('追加') } })
  if (!baseline) { assert.ok(cache.html, 'final cache was empty'); assert.ok(cache.tailVisible, 'final text tail disappeared') }
  let historyReading = null
  if (!baseline) {
    const viewport = page.locator('.chat-message-viewport [data-radix-scroll-area-viewport]')
    await viewport.evaluate(el => { el.scrollTop = 100; el.dispatchEvent(new Event('scroll')) })
    await page.waitForTimeout(100)
    const before = await viewport.evaluate(el => el.scrollTop)
    await page.evaluate(() => {
      const store = window.__perfStore, state = store.getState()
      store.setState({ isStreaming: true, activeStreamSessionId: 991, messageBodies: { ...state.messageBodies, '8': { ...state.messageBodies['8'], content: state.messageBodies['8'].content + '主动上滚时追加中文末尾', version: state.messageBodies['8'].version + 1 } } })
    })
    await page.waitForTimeout(400)
    const after = await viewport.evaluate(el => el.scrollTop)
    assert.ok(Math.abs(after - before) < 80, 'streaming pulled historical reader to the bottom')
    historyReading = { before, after }
    await page.evaluate(() => window.__perfStore.setState({ isStreaming: false, activeStreamSessionId: null }))
  }
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile horizontal overflow')
  const workerEvents = await page.evaluate(() => window.__workerEvents || [])
  const workerScripts = (await page.evaluate(() => window.__workerUrls || [])).map(url => ({ url, status: scriptResponses.get(url) }))
  if (!baseline) assert.ok(workerScripts.length && workerScripts.every(script => script.status === 200), 'packaged Worker script did not load successfully')
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.initiatorType === 'script').reduce((sum, e) => ({ transfer: sum.transfer + e.transferSize, decoded: sum.decoded + e.decodedBodySize }), { transfer: 0, decoded: 0 }))
  if (!baseline) assert.equal(errors.some(e => /DOMParser|document is not defined|SecurityError/.test(e)), false, 'Worker DOM dependency failure')
  let input = null
  const faults = []
  const flows = {}
  if (historyReading) flows.historyReading = historyReading
  if (!baseline) {
    const textarea = page.locator('textarea:visible').first()
    await textarea.fill('中文输入法组合测试，多行粘贴内容' + nl + Array.from({ length: 8 }, (_, i) => '中文粘贴第' + (i + 1) + '行').join(nl))
    await textarea.dispatchEvent('compositionstart', { data: '中' })
    await textarea.press('Enter')
    await textarea.dispatchEvent('compositionend', { data: '中文' })
    await page.waitForFunction(() => [...document.querySelectorAll('textarea:not([aria-hidden])')].some(el => el.clientWidth > 0 && el.clientHeight > 64))
    input = { value: await textarea.inputValue(), height: await textarea.evaluate(el => el.clientHeight) }
    assert.ok(input.value.includes('中文粘贴第8行'), 'composition discarded input')
    await page.screenshot({ path: path.join(output, 'mobile-input.png'), fullPage: true })
    await textarea.fill('')
    await page.waitForTimeout(100)
    input.clearedHeight = await textarea.evaluate(el => el.clientHeight)
    assert.ok(input.clearedHeight < input.height, 'clearing did not shrink the textarea')
    for (const mode of ['constructor', 'unresponsive']) {
      const faultPage = await context.newPage()
      await faultPage.addInitScript(mode => {
        const RealWorker = window.Worker
        window.__restoreWorker = () => { window.Worker = RealWorker }
        window.Worker = mode === 'constructor'
          ? class { constructor() { throw new Error('injected-construction-failure') } }
          : class { addEventListener() {} postMessage() {} terminate() {} }
      }, mode)
      await faultPage.goto(baseURL + '/main/991', { waitUntil: 'networkidle' })
      await faultPage.waitForFunction(() => document.body.textContent.includes('格式渲染暂不可用'), null, { timeout: 6500 })
      assert.ok((await faultPage.locator('body').textContent()).includes('中文回归验证'), 'failure hid the source text')
      await faultPage.evaluate(() => window.__restoreWorker())
      await faultPage.waitForSelector('.katex', { timeout: 16000 })
      await faultPage.waitForSelector('.rs-terminal', { timeout: 10000 })
      faults.push({ mode, fallbackVisible: true, samePageRecovered: true })
      await faultPage.close()
    }
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.katex', { timeout: 10000 })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('.chat-message-viewport [data-radix-scroll-area-viewport]').evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForFunction(() => [...document.querySelectorAll('.katex-mathml')].every(el => getComputedStyle(el).position === 'absolute'))
    await page.screenshot({ path: path.join(output, 'formatted-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.chat-message-viewport [data-radix-scroll-area-viewport]').evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.screenshot({ path: path.join(output, 'formatted-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await attachStore(page)
    await page.evaluate(() => {
      const store = window.__perfStore, state = store.getState()
      const reasoning = Array.from({ length: 10000 }, (_, i) => '中文推理第' + i + '行，验证折叠窗口与展开阅读。').join(String.fromCharCode(10))
      store.setState({ messageBodies: { ...state.messageBodies, '8': { ...state.messageBodies['8'], reasoning } }, messageMetas: state.messageMetas.map(m => m.id === 8 ? { ...m, reasoningStatus: 'done' } : m) })
    })
    const reasoningButton = page.getByRole('button', { name: /深度思考/ }).last()
    await reasoningButton.waitFor()
    assert.equal(await reasoningButton.getAttribute('aria-expanded'), 'false')
    const collapsedLines = await reasoningButton.locator('span').count()
    assert.ok(collapsedLines < 12, 'collapsed reasoning rendered too many lines')
    await reasoningButton.click()
    await page.getByText('中文推理第9999行，验证折叠窗口与展开阅读。', { exact: false }).waitFor()
    await page.screenshot({ path: path.join(output, 'reasoning-expanded.png'), fullPage: true })
    await reasoningButton.click()
    flows.reasoning = { lines: 10000, collapsedSpans: collapsedLines, expanded: true }
    for (const streamStatus of ['stopped', 'error']) {
      await page.evaluate(status => {
        const store = window.__perfStore, state = store.getState()
        store.setState({ isStreaming: false, activeStreamSessionId: null, messageMetas: state.messageMetas.map(m => m.id === 8 ? { ...m, streamStatus: status } : m), messageBodies: { ...state.messageBodies, '8': { ...state.messageBodies['8'], content: '终态回归 **' + status + '** 完整中文末尾', version: state.messageBodies['8'].version + 1 } } })
      }, streamStatus)
      await page.waitForFunction(status => window.__perfStore.getState().messageRenderCache['8']?.sourceContent?.includes(status), streamStatus, { timeout: 8000 })
    }
    flows.finalStatuses = ['stopped', 'error']
    const restored = await page.evaluate(async () => {
      const store = window.__perfStore, original = store.getState().currentSession
      store.setState({ sessions: [...store.getState().sessions, { ...original, id: 992, title: '会话切换回归' }], messagesHydrated: { ...store.getState().messagesHydrated, 992: true } })
      await store.getState().selectSession(992)
      await store.getState().selectSession(991)
      return store.getState().currentSession.id
    })
    assert.equal(restored, 991)
    flows.sessionSwitchRestored = true
    await page.getByRole('button', { name: '设置', exact: true }).first().click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({ path: path.join(output, 'settings-dialog.png'), fullPage: true })
    assert.equal(requests.some(p => p.includes('/skills/') || p.includes('/shares')), false, 'profile eagerly requested unrelated lists')
    flows.settingsFirstOpen = true
    await page.keyboard.press('Escape')
    await page.goto(baseURL + '/main/settings/personal#settings-personal-skills', { waitUntil: 'networkidle' })
    await page.waitForSelector('#settings-personal-skills', { timeout: 10000 })
    assert.equal(await page.locator('#settings-share-management').count(), 0)
    await page.getByRole('button', { name: '分享管理', exact: true }).click()
    await page.waitForSelector('#settings-share-management')
    await page.goBack()
    await page.waitForSelector('#settings-personal-skills')
    await page.goForward()
    await page.waitForSelector('#settings-share-management')
    await page.screenshot({ path: path.join(output, 'settings-deeplink.png'), fullPage: true })
    flows.personalHashHistory = true
    await page.goto(baseURL + '/share/performance', { waitUntil: 'networkidle' })
    await page.waitForSelector('.katex', { timeout: 10000 })
    await page.waitForSelector('.rs-terminal', { timeout: 10000 })
    await page.screenshot({ path: path.join(output, 'share.png'), fullPage: true })
    flows.sharedConversation = true
    await page.goto(baseURL + '/share/battle/performance', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /回归模型/ }).last().click()
    await page.getByRole('button', { name: /第1 次/ }).click()
    await page.getByRole('dialog').locator('.katex').waitFor({ timeout: 10000 })
    await page.getByRole('dialog').locator('.rs-terminal').waitFor({ timeout: 10000 })
    await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] .katex-mathml')].every(el => getComputedStyle(el).position === 'absolute'))
    await page.screenshot({ path: path.join(output, 'battle-share.png'), fullPage: true })
    flows.battleSharedRenderer = true
    const loadingPage = await context.newPage()
    await loadingPage.addInitScript(() => localStorage.removeItem('auth-storage'))
    let releaseActor
    const actorGate = new Promise(resolve => { releaseActor = resolve })
    await loadingPage.route('**/api/auth/actor', async route => {
      await actorGate
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { actor: { type: 'user', id: 1, username: '加载回归用户', role: 'USER', status: 'ACTIVE' }, quota: null } }) })
    })
    await loadingPage.goto(baseURL + '/main/991', { waitUntil: 'domcontentloaded' })
    await loadingPage.locator('[data-app-shell="loading"]').waitFor()
    assert.equal(await loadingPage.locator('[data-app-shell="ready"]').count(), 0, 'loading screenshot exposed an authenticated shell')
    assert.equal((await loadingPage.locator('body').textContent()).includes('中文历史提问'), false, 'loading shell exposed historical content')
    await loadingPage.screenshot({ path: path.join(output, 'loading-shell.png'), fullPage: true })
    releaseActor()
    await loadingPage.locator('[data-app-shell="ready"]').waitFor()
    await loadingPage.close()
    flows.loadingShell = true
  }
  if (!baseline) assert.deepEqual(uncaughtErrors, [], 'uncaught application error during browser regression')
  const result = { baseline, navigationMs, metrics, cache, resources, input, faults, flows, errors, uncaughtErrors, workerEvents, workerScripts, requests }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + nl)
  process.stdout.write(JSON.stringify(result, null, 2) + nl)
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  const state = await page.evaluate(() => ({ url: location.href, body: document.body.innerText })).catch(() => null)
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), state, errors, requests }, null, 2) + nl)
  throw error
} finally {
  await browser.close()
  if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve))
}
