jest.mock('../config/storage', () => {
  const actual = jest.requireActual('../config/storage')
  return {
    ...actual,
    CHAT_IMAGE_BASE_URL: '',
  }
})

import os from 'node:os'
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

  it('keeps the request host unchanged by default (no LAN rewrite)', () => {
    const request = buildRequest('http://localhost:3000/api/settings', { host: 'localhost:3000' })

    expect(determineChatImageBaseUrl({ request, siteBaseUrl: null })).toBe('http://localhost:3000')
  })

  it('rewrites localhost to a LAN IPv4 only when CHAT_IMAGE_FORCE_LAN=true', () => {
    const previous = process.env.CHAT_IMAGE_FORCE_LAN
    process.env.CHAT_IMAGE_FORCE_LAN = 'true'
    const spy = jest.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [
        {
          address: '192.168.1.50',
          family: 'IPv4',
          internal: false,
          mac: '00:00:00:00:00:00',
          netmask: '255.255.255.0',
          cidr: '192.168.1.50/24',
        },
      ],
    } as any)

    try {
      const request = buildRequest('http://localhost:3000/api/settings', { host: 'localhost:3000' })

      expect(determineChatImageBaseUrl({ request, siteBaseUrl: null })).toBe('http://192.168.1.50:3000')
    } finally {
      spy.mockRestore()
      if (previous === undefined) {
        delete process.env.CHAT_IMAGE_FORCE_LAN
      } else {
        process.env.CHAT_IMAGE_FORCE_LAN = previous
      }
    }
  })
})
