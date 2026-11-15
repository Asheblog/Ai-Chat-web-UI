import { describe, expect, it } from 'vitest'
import {
  WEB_SEARCH_SCOPE_OPTIONS,
  composerToolbarButtonClass,
  composerToolbarIconClass,
  composerToolbarScrollClass,
  composerToolbarSendSlotClass,
  formatWebSearchScopeLabel,
} from '@/components/chat/composer-toolbar-primitives'
import { WEB_SEARCH_SCOPE_IDS } from '@aichat/shared'

describe('composer toolbar adaptive layout', () => {
  it('uses a named container with horizontal scroll fallback instead of overflow-visible', () => {
    expect(composerToolbarScrollClass).toContain('composer-toolbar')
    expect(composerToolbarScrollClass).toContain('overflow-x-auto')
    expect(composerToolbarScrollClass).not.toContain('overflow-visible')
  })

  it('marks toolbar buttons and icons for container-driven sizing', () => {
    expect(composerToolbarButtonClass).toContain('composer-toolbar-btn')
    expect(composerToolbarButtonClass).not.toMatch(/\bh-11\b/)
    expect(composerToolbarButtonClass).not.toMatch(/\bw-11\b/)
    expect(composerToolbarIconClass).toContain('composer-toolbar-icon')
    expect(composerToolbarSendSlotClass).toContain('shrink-0')
    expect(composerToolbarSendSlotClass).toContain('z-10')
  })
})

describe('web search scope vocabulary', () => {
  it('derives the options from the shared seven-value enum', () => {
    expect(WEB_SEARCH_SCOPE_OPTIONS.map((option) => option.value)).toEqual([...WEB_SEARCH_SCOPE_IDS])
    expect(WEB_SEARCH_SCOPE_OPTIONS).toHaveLength(7)
  })

  it('labels every scope in Chinese, including scholar', () => {
    const labels = WEB_SEARCH_SCOPE_OPTIONS.map((option) => option.label)
    expect(labels).toEqual(['网页', '文档', '论文', '学术', '图片', '视频', '播客'])
    expect(formatWebSearchScopeLabel('scholar')).toBe('学术')
  })

  it('falls back to the raw value for unknown scopes', () => {
    expect(formatWebSearchScopeLabel('unknown-scope')).toBe('unknown-scope')
    expect(formatWebSearchScopeLabel(undefined)).toBe('网页')
    expect(formatWebSearchScopeLabel('')).toBe('网页')
  })

  it('never resolves prototype keys from a polluted preference value', () => {
    // 回归：改用 Object.hasOwn 后，localStorage 被手工写入 constructor / __proto__ 时仍返回字符串
    for (const polluted of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const label = formatWebSearchScopeLabel(polluted)
      expect(typeof label).toBe('string')
      expect(label).toBe(polluted)
    }
    expect(() => formatWebSearchScopeLabel('__proto__')).not.toThrow()
  })
})
