import { isDisallowedHostname, normalizeHostname } from '../host-safety'

describe('host-safety', () => {
  it('normalizes bracketed IPv6 and zone identifiers', () => {
    expect(normalizeHostname('[::1]')).toBe('::1')
    expect(normalizeHostname('[fe80::1%25eth0]')).toBe('fe80::1')
    expect(normalizeHostname('EXAMPLE.COM.')).toBe('example.com')
  })

  it.each([
    'localhost',
    'api.localhost',
    'printer.local',
    'metadata.internal',
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '[::1]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
    '[ff02::1]',
    '[::]',
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
    '[::ffff:10.0.0.1]',
    '[0:0:0:0:0:0:0:1]',
  ])('blocks private or local hostname %s', (hostname) => {
    expect(isDisallowedHostname(hostname)).toBe(true)
  })

  it.each([
    'example.com',
    'docs.example.com',
    '172.2.1.2',
    '8.8.8.8',
    '[2001:4860:4860::8888]',
    '[2606:4700:4700::1111]',
    '[::ffff:8.8.8.8]',
  ])('allows public hostname %s', (hostname) => {
    expect(isDisallowedHostname(hostname)).toBe(false)
  })
})
