const invalid = { ok: false, kind: 'invalid' }

export function parseServerAddress(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value || /[\s\\?#]/u.test(value)) return invalid
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value
  if (!/^https?:\/\/[^/@]+\/?$/i.test(absolute)) return invalid
  try {
    const url = new URL(absolute)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return { ok: true, origin: url.origin, insecure: url.protocol === 'http:' && !loopback }
  } catch {
    return invalid
  }
}

export function externalWebUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

export function classifyNavigation(origin, value) {
  const url = externalWebUrl(value)
  return !url ? 'blocked' : url.origin === origin ? 'site' : 'external'
}

export function isCertificateError(error) {
  const value = [error, error?.cause?.code, error?.cause?.message].join(' ')
  return /ERR_CERT|ERR_SSL|CERT_|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|DEPTH_ZERO_SELF_SIGNED_CERT/i.test(value)
}

async function probeSplitProxy(origin, request) {
  // The site root redirects to /main. Fetch that known same-origin page directly.
  const homepage = await request(origin + '/main', 'text/html')
  if (homepage.status >= 500) return 'unreachable'
  if (!homepage.ok || !homepage.headers.get('content-type')?.includes('text/html')) return 'not-aichat'
  // The site title is customizable; the root layout description is shared by these deployments.
  const html = await homepage.text()
  const marker = /<meta\s+name="description"\s+content="一个轻量级、易部署的AI聊天应用"\s*\/?>/iu
  if (!marker.test(html)) return 'not-aichat'

  const backend = await request(origin + '/api/settings/health', 'application/json')
  if (backend.status >= 500) return 'unreachable'
  if (!backend.ok || !backend.headers.get('content-type')?.includes('application/json')) return 'not-aichat'
  const { success, data } = await backend.json()
  if (success !== true || typeof data?.version !== 'string') return 'not-aichat'
  return data.status === 'healthy' && data.database === 'connected' ? null : 'unreachable'
}

export async function connectToServer(input, { fetch, allowInsecure = false, timeoutMs = 8000 }) {
  const parsed = parseServerAddress(input)
  if (!parsed.ok) return parsed
  const { origin } = parsed
  if (parsed.insecure && !allowInsecure) return { ok: false, kind: 'insecure', origin }
  try {
    const signal = AbortSignal.timeout(timeoutMs)
    const request = (url, accept) => fetch(url, {
      credentials: 'omit',
      redirect: 'manual',
      headers: { Accept: accept },
      signal,
    })
    const response = await request(origin + '/api/health', 'application/json')
    if (response.status === 404) {
      const kind = await probeSplitProxy(origin, request)
      return kind ? { ok: false, kind, origin } : parsed
    }
    if (response.status >= 500) return { ok: false, kind: 'unreachable', origin }
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const body = await response.json()
      if (body?.status === 'ok' && body?.service === 'aichat-frontend') return parsed
    }
    return { ok: false, kind: 'not-aichat', origin }
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, kind: 'not-aichat', origin }
    return { ok: false, kind: isCertificateError(error) ? 'certificate' : 'unreachable', origin }
  }
}
