import { parseGithubSkillSource } from '../skill-github-fetcher'

describe('parseGithubSkillSource', () => {
  it('parses owner/repo@ref:subdir', () => {
    const parsed = parseGithubSkillSource('anthropics/skills@main:skills/pptx')
    expect(parsed).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subdir: 'skills/pptx',
    })
  })

  it('parses github tree URL', () => {
    const parsed = parseGithubSkillSource('https://github.com/anthropics/skills/tree/main/skills/pptx')
    expect(parsed).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subdir: 'skills/pptx',
    })
  })

  it('parses github blob URL pointing to SKILL.md', () => {
    const parsed = parseGithubSkillSource('https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md')
    expect(parsed).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      subdir: 'skills/pptx',
    })
  })

  it('rejects unsupported source', () => {
    expect(() => parseGithubSkillSource('https://example.com/a/b')).toThrow(
      /owner\/repo@ref\[:subdir\]/,
    )
  })
})
