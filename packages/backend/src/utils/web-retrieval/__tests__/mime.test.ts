import { sniffContentType } from '../mime'

const sniff = (buffer: string | Buffer, headerContentType?: string, url = 'https://example.com/page'): ReturnType<typeof sniffContentType> =>
  sniffContentType({
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8'),
    headerContentType,
    url,
  })

describe('sniffContentType', () => {
  test('keeps a declared html content type', () => {
    expect(sniff('<!DOCTYPE html><html></html>', 'text/html; charset=utf-8')).toEqual({
      contentType: 'text/html',
      declared: 'text/html',
      sniffed: false,
    })
  })

  test('sniffs html when the header is missing', () => {
    const verdict = sniff('  <!DOCTYPE html><html><body>content</body></html>')
    expect(verdict).toMatchObject({ contentType: 'text/html', sniffed: true })
    expect(verdict.declared).toBeUndefined()
  })

  test('sniffs html behind a BOM and whitespace prefix', () => {
    expect(sniff('\uFEFF\n\t<html lang="zh-CN"><body>正文</body></html>').contentType).toBe('text/html')
  })

  test('overrides a generic octet-stream for html', () => {
    const verdict = sniff('<html><body>内容</body></html>', 'application/octet-stream')
    expect(verdict).toMatchObject({ contentType: 'text/html', sniffed: true, declared: 'application/octet-stream' })
  })

  test('sniffs pdf magic bytes', () => {
    expect(sniff('%PDF-1.7\n%...', undefined, 'https://example.com/report').contentType).toBe('application/pdf')
  })

  test('sniffs common image magic bytes', () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), undefined, 'https://example.com/a').contentType).toBe('image/png')
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), undefined, 'https://example.com/b').contentType).toBe('image/jpeg')
    expect(sniff(Buffer.from('GIF89a', 'latin1'), undefined, 'https://example.com/c').contentType).toBe('image/gif')
    expect(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]), undefined, 'https://example.com/d').contentType).toBe('image/webp')
  })

  test('sniffs feed documents', () => {
    expect(sniff('<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>').contentType).toBe('application/rss+xml')
    expect(sniff('<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title></feed>').contentType).toBe('application/atom+xml')
  })

  test('sniffs json', () => {
    expect(sniff('{"ok":true,"items":[]}').contentType).toBe('application/json')
  })

  test('sniffs csv only when the url says csv', () => {
    expect(sniff('name,price\n苹果,3.5\n', undefined, 'https://example.com/prices.csv').contentType).toBe('text/csv')
    expect(sniff('name,price\n苹果,3.5\n', undefined, 'https://example.com/report').contentType).toBe('text/plain')
  })

  test('falls back to a supported transport hint for docx zip containers', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)])
    expect(sniff(zip, undefined, 'https://example.com/a.docx').contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(sniff(zip, undefined, 'https://example.com/a.zip').contentType).toBe('application/zip')
  })

  test('treats plain text as text/plain and never as html on a single angle bracket', () => {
    expect(sniff('a < b and c > d\nsecond line').contentType).toBe('text/plain')
  })

  test('only inspects the bounded prefix, not a late html body', () => {
    const filler = 'x'.repeat(4096)
    expect(sniff(filler + '<html><body>late</body></html>').contentType).toBe('text/plain')
  })
})
