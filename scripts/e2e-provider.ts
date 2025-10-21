#!/usr/bin/env -S node -r tsx/register
/**
 * E2E: 直连第三方 Chat Completions 提供方，验证最小问答可用性
 * - API: env E2E_API_BASE (默认 https://ai.asheblog.org/v1)
 * - KEY: env E2E_API_KEY （必填，不写入仓库）
 * - Model: env E2E_MODEL （默认 ZhipuAI/GLM-4.6）
 * 退避策略：429 -> 15s；5xx/超时 -> 2s，最多重试 1 次
 * 兼容 Win/Linux：纯 Node 脚本，无 shell 特性依赖
 */

const API_BASE = process.env.E2E_API_BASE?.replace(/\/$/, '') || 'https://ai.asheblog.org/v1'
const API_KEY = process.env.E2E_API_KEY || ''
const MODEL = process.env.E2E_MODEL || 'ZhipuAI/GLM-4.6'
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT || '45000')

function die(msg: string): never {
  console.error(`\n❌ E2E 失败: ${msg}`)
  process.exit(1)
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

async function fetchWithTimeout(url: string, opts: any, timeoutMs: number) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal } as any)
    return res
  } finally {
    clearTimeout(id)
  }
}

async function runOnce(tag: string) {
  const url = `${API_BASE}/chat/completions`
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: '你是一个简洁的助手。' },
      { role: 'user', content: '用不超过15个字回答：你是哪个模型？只返回纯文本。' },
    ],
    stream: false,
    temperature: 0.2,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  }

  const start = Date.now()
  const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, TIMEOUT_MS)
  const ms = Date.now() - start
  let text = await res.text()

  // 尝试解析 JSON，但容错保留原文
  let json: any = null
  try { json = JSON.parse(text) } catch {}

  console.log(`\n[${tag}] HTTP ${res.status} (${ms}ms) -> ${url}`)
  if (!res.ok) {
    console.log('响应体预览:', text.slice(0, 400))
    const err: any = new Error(`HTTP ${res.status}`)
    ;(err.code as any) = res.status
    throw err
  }

  const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content
  if (!content || typeof content !== 'string') {
    console.log('原始响应体:', text.slice(0, 400))
    throw new Error('响应格式异常：未找到 content 字段')
  }
  console.log('模型:', json?.model || MODEL)
  console.log('回答预览:', content.trim().slice(0, 120))

  // 简单断言：非空文本
  if (!content.trim()) throw new Error('回答为空')
}

async function main() {
  console.log('🧪 E2E 开始 - Chat Completions 提供方')
  console.log('Base:', API_BASE)
  console.log('Model:', MODEL)
  if (!API_KEY) die('未提供 E2E_API_KEY')

  // 第一次尝试
  try {
    await runOnce('try#1')
    console.log('\n✅ E2E 通过')
    process.exit(0)
  } catch (e: any) {
    const code = Number(e?.code || 0)
    console.warn('首次失败：', e?.message)

    // 退避
    if (code === 429) {
      console.warn('429 限流，15s 后重试一次...')
      await sleep(15000)
    } else if ((code >= 500 && code < 600) || e?.message?.includes('timeout') || e?.name === 'AbortError') {
      console.warn('5xx/超时，2s 后重试一次...')
      await sleep(2000)
    } else {
      die(`不可重试错误：${e?.message}`)
    }

    try {
      await runOnce('try#2')
      console.log('\n✅ E2E 通过（重试）')
      process.exit(0)
    } catch (e2: any) {
      console.error('重试仍失败：', e2?.message)
      die('E2E 失败：供应商接口暂不可用或参数不兼容。请稍后重试/核对模型、鉴权、返回格式。')
    }
  }
}

main().catch((e) => die(e?.message || '未知错误'))

