import test from 'node:test'
import assert from 'node:assert/strict'
import { connectToServer, parseServerAddress, classifyNavigation, externalWebUrl } from '../src/connection.mjs'

const site = 'https://chat.example.test:8443'
const json = (body) => Response.json(body)

test('accepts an origin, supplies HTTPS, and rejects API paths and credentials', () => {
  assert.deepEqual(parseServerAddress(' Chat.Example.test:8443/ '), { ok: true, origin: site, insecure: false })
  assert.deepEqual(parseServerAddress('http://127.0.0.1:3000'), { ok: true, origin: 'http://127.0.0.1:3000', insecure: false })
  for (const value of ['https://chat.example.test/api', 'https://u:p@chat.example.test', 'file:///C:/', 'https://chat.example.test/?q=x', 'https://chat.example.test/#login', 'https://chat.example.test\\other', 'https://chat.example.test/../']) {
    assert.equal(parseServerAddress(value).kind, 'invalid', value)
  }
})

test('asks before connecting to non-loopback HTTP and does not fetch before confirmation', async () => {
  const result = await connectToServer('http://192.168.1.4:3000', { fetch: () => assert.fail('Must not connect before confirmation') })
  assert.deepEqual(result, { ok: false, kind: 'insecure', origin: 'http://192.168.1.4:3000' })
})

test('confirms the frontend health identity without credentials or redirects', async () => {
  let called = 0
  const result = await connectToServer(site, { fetch: async (url, init) => {
    called++
    assert.equal(url, site + '/api/health')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.credentials, 'omit')
    assert.ok(init.signal instanceof AbortSignal)
    return json({ status: 'ok', service: 'aichat-frontend' })
  } })
  assert.deepEqual(result, { ok: true, origin: site, insecure: false })
  assert.equal(called, 1)
})

test('differentiates wrong sites, unavailability and certificate failures', async () => {
  const probe = (fetch) => connectToServer(site, { fetch })
  assert.equal((await probe(async () => json({ status: 'ok' }))).kind, 'not-aichat')
  assert.equal((await probe(async () => new Response(null, { status: 302 }))).kind, 'not-aichat')
  assert.equal((await probe(async () => new Response(null, { status: 503 }))).kind, 'unreachable')
  assert.equal((await probe(async () => { throw new Error('net::ERR_CERT_AUTHORITY_INVALID') })).kind, 'certificate')
})

test('supports split proxies only when both the homepage and backend identify AI Chat', async () => {
  const healthy = { success: true, data: { status: 'healthy', database: 'connected', version: '2.1.0' } }
  const description = '<meta name="description" content="一个轻量级、易部署的AI聊天应用"/>'
  const client = (head, health) => connectToServer(site, { fetch: async (url, init) => {
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'manual')
    if (url.endsWith('/api/health')) return new Response(null, { status: 404 })
    if (url.endsWith('/api/settings/health')) return json(health)
    assert.equal(url, site + '/main', 'probe the known page directly without following homepage redirects')
    return new Response('<!doctype html><head>' + head + '</head>', { headers: { 'Content-Type': 'text/html' } })
  } })
  assert.equal((await client(description, healthy)).ok, true)
  assert.equal((await client('<title>Generic site</title>', healthy)).kind, 'not-aichat')
  assert.equal((await client(description, { status: 'ok' })).kind, 'not-aichat')
  assert.equal((await client(description, { ...healthy, data: { ...healthy.data, database: 'disconnected' } })).kind, 'unreachable')
})

test('bounds a slow probe', async () => {
  const result = await connectToServer(site, { timeoutMs: 10, fetch: (_url, { signal }) => new Promise((_, reject) => {
    const pending = setTimeout(() => reject(new Error('Probe did not time out')), 1000)
    signal.addEventListener('abort', () => {
      clearTimeout(pending)
      reject(signal.reason)
    }, { once: true })
  }) })
  assert.equal(result.kind, 'unreachable')
})

test('keeps same-origin links in-app, opens external web links, and blocks other schemes', () => {
  assert.equal(classifyNavigation(site, site + '/main'), 'site')
  assert.equal(classifyNavigation(site, 'https://research.example.test/a'), 'external')
  assert.equal(classifyNavigation(site, 'http://chat.example.test:8443/main'), 'external')
  for (const url of ['file:///C:/private', 'javascript:alert(1)', 'data:text/html,example', 'https://u:p@example.test/', 'custom:action']) {
    assert.equal(classifyNavigation(site, url), 'blocked')
    assert.equal(externalWebUrl(url), null)
  }
})
