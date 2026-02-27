jest.mock('../config/storage', () => {
  const actual = jest.requireActual('../config/storage')
  return {
    ...actual,
    CHAT_IMAGE_BASE_URL: '',
  }
})

import type { Request } from 'undici'
import { determineChatImageBaseUrl } from './chat-images'

const buildRequest = (url: string, headers: Record<string, string>): Request =>
  new Request(url, { headers })

describe('determineChatImageBaseUrl', () => {
  it('uses forwarded proto when host header exists', () => {
    const request = buildRequest('http://127.0.0.1/api/chat', {
      host: 'chat.example.com',
      'x-forwarded-proto': 'https',
    })

    expect(determineChatImageBaseUrl({ request, siteBaseUrl: null })).toBe('https://chat.example.com')
  })

  it('prefers forwarded host and forwarded port', () => {
    const request = buildRequest('http://127.0.0.1/api/chat', {
      host: '127.0.0.1:8787',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'edge.example.com',
      'x-forwarded-port': '8443',
    })

    expect(determineChatImageBaseUrl({ request, siteBaseUrl: null })).toBe('https://edge.example.com:8443')
  })

  it('uses the first forwarded value when proxy headers contain multiple entries', () => {
    const request = buildRequest('http://127.0.0.1/api/chat', {
      host: '127.0.0.1:8787',
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'edge.example.com, internal.example.local',
      'x-forwarded-port': '443, 8787',
    })

    expect(determineChatImageBaseUrl({ request, siteBaseUrl: null })).toBe('https://edge.example.com:443')
  })
})
