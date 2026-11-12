import { parseExtensionSource, toNamespaceKey, toSourceUrl } from '../source-parser'

describe('parseExtensionSource', () => {
  it('parses plain repo url', () => {
    expect(parseExtensionSource('https://github.com/acme/demo')).toMatchObject({
      owner: 'acme',
      repo: 'demo',
    })
  })

  it('parses tree url with subdir', () => {
    expect(parseExtensionSource('https://github.com/acme/demo/tree/main/skills/foo')).toMatchObject({
      owner: 'acme',
      repo: 'demo',
      ref: 'main',
      subdir: 'skills/foo',
    })
  })

  it('treats blob SKILL.md as its parent dir', () => {
    expect(
      parseExtensionSource('https://github.com/acme/demo/blob/main/skills/foo/SKILL.md'),
    ).toMatchObject({ ref: 'main', subdir: 'skills/foo' })
  })

  it('parses raw.githubusercontent links', () => {
    expect(
      parseExtensionSource('https://raw.githubusercontent.com/acme/demo/main/skills/foo/SKILL.md'),
    ).toMatchObject({ owner: 'acme', repo: 'demo', ref: 'main', subdir: 'skills/foo' })
  })

  it('parses owner/repo@ref:subdir shorthand', () => {
    expect(parseExtensionSource('acme/demo@v1:skills/foo')).toMatchObject({
      owner: 'acme',
      repo: 'demo',
      ref: 'v1',
      subdir: 'skills/foo',
    })
  })

  it('parses scp style git url', () => {
    expect(parseExtensionSource('git@github.com:acme/demo.git')).toMatchObject({
      owner: 'acme',
      repo: 'demo',
    })
  })

  it('strips trailing punctuation picked up from chat text', () => {
    expect(parseExtensionSource('https://github.com/acme/demo.')).toMatchObject({ repo: 'demo' })
  })

  it('rejects non-github hosts', () => {
    expect(() => parseExtensionSource('https://gitlab.com/acme/demo')).toThrow(/只支持 GitHub/)
  })

  it('rejects empty source', () => {
    expect(() => parseExtensionSource('   ')).toThrow(/为空/)
  })
})

describe('namespace key', () => {
  it('is stable and lowercased', () => {
    const ref = parseExtensionSource('https://github.com/Acme/Demo')
    expect(toNamespaceKey(ref)).toBe('acme/demo')
  })

  it('includes subdir', () => {
    const ref = parseExtensionSource('https://github.com/acme/demo/tree/main/skills/foo')
    expect(toNamespaceKey(ref)).toBe('acme/demo#skills/foo')
  })

  it('builds a readable source url', () => {
    const ref = parseExtensionSource('https://github.com/acme/demo/tree/main/skills/foo')
    expect(toSourceUrl(ref)).toBe('https://github.com/acme/demo/tree/main/skills/foo')
  })
})
