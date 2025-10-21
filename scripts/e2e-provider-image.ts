#!/usr/bin/env -S node -r tsx/register
/**
 * E2E：多模态（图片）测试，读取项目根目录 123.jpg
 */
import fs from 'node:fs'
import path from 'node:path'

const API_BASE = (process.env.E2E_API_BASE || 'https://ai.asheblog.org/v1').replace(/\/$/, '')
const API_KEY = process.env.E2E_API_KEY || ''
const MODEL = process.env.E2E_MODEL || 'ZhipuAI/GLM-4.6'
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT || '45000')

function die(msg: string): never { console.error(`\n❌ E2E(IMG) 失败: ${msg}`); process.exit(1) }
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

async function fetchWithTimeout(url: string, opts: any, timeoutMs: number) {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs)
  try { return await fetch(url, { ...opts, signal: ctrl.signal } as any) } finally { clearTimeout(id) }
}

function readImageBase64(): { dataUrl: string; mime: string } {
  const p = path.resolve(process.cwd(), '123.jpg')
  if (!fs.existsSync(p)) die('根目录未找到 123.jpg')
  const buf = fs.readFileSync(p)
  const b64 = buf.toString('base64')
  const mime = 'image/jpeg'
  return { dataUrl: `data:${mime};base64,${b64}`, mime }
}

function buildBodies(dataUrl: string) {
  // 尝试不同供应商常见格式
  return [
    // v1: OpenAI 风格（对象）
    {
      model: MODEL,
      messages: [
        { role: 'user', content: [ { type: 'text', text: '请用不超过20个字描述图片。' }, { type: 'image_url', image_url: { url: dataUrl } } ] }
      ],
      stream: false,
      temperature: 0.2,
    },
    // v2: image_url 为字符串
    {
      model: MODEL,
      messages: [
        { role: 'user', content: [ { type: 'text', text: '请用不超过20个字描述图片。' }, { type: 'image_url', image_url: dataUrl } ] }
      ],
      stream: false,
      temperature: 0.2,
    },
  ]
}

async function runOnce(tag: string) {
  const { dataUrl } = readImageBase64()
  const url = `${API_BASE}/chat/completions`
  const bodies = buildBodies(dataUrl)
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }
  let lastErr: any = null
  for (let i = 0; i < bodies.length; i++) {
    const start = Date.now()
    const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(bodies[i]) }, TIMEOUT_MS)
    const ms = Date.now() - start
    const text = await res.text()
    let json: any = null; try { json = JSON.parse(text) } catch {}
    console.log(`\n[${tag}/v${i+1}] HTTP ${res.status} (${ms}ms) -> ${url}`)
    if (!res.ok) { console.log('响应体预览:', text.slice(0, 400)); lastErr = new Error(`HTTP ${res.status}`); (lastErr.code as any) = res.status; continue }
    const content = json?.choices?.[0]?.message?.content
    if (!content || typeof content !== 'string') { console.log('原始响应体:', text.slice(0, 400)); lastErr = new Error('响应格式异常：未找到 content'); continue }
    console.log('回答预览:', content.trim().slice(0, 120))
    if (!content.trim()) { lastErr = new Error('回答为空'); continue }
    return // success
  }
  throw lastErr || new Error('未知错误')
}

async function main() {
  console.log('🧪 E2E(IMG) 开始 - 多模态图片')
  console.log('Base:', API_BASE)
  console.log('Model:', MODEL)
  if (!API_KEY) die('未提供 E2E_API_KEY')

  try {
    await runOnce('try#1')
    console.log('\n✅ E2E(IMG) 通过')
    process.exit(0)
  } catch (e: any) {
    const code = Number(e?.code || 0)
    console.warn('首次失败：', e?.message)
    if (code === 429) { console.warn('429 限流，15s 后重试一次...'); await sleep(15000) }
    else if ((code >= 500 && code < 600) || e?.message?.includes('timeout') || e?.name === 'AbortError') { console.warn('5xx/超时，2s 后重试一次...'); await sleep(2000) }
    else die(`不可重试错误：${e?.message}`)
    try { await runOnce('try#2'); console.log('\n✅ E2E(IMG) 通过（重试）'); process.exit(0) } catch (e2: any) { console.error('重试仍失败：', e2?.message); die('E2E(IMG) 失败') }
  }
}

main().catch((e) => die(e?.message || '未知错误'))
