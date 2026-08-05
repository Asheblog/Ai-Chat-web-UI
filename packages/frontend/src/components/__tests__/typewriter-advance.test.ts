import { describe, expect, it } from 'vitest'
import { resolveTypewriterAdvanceIndex } from '@/components/typewriter-advance'

describe('resolveTypewriterAdvanceIndex', () => {
  it('文本追加时保留已播放游标', () => {
    expect(resolveTypewriterAdvanceIndex('你', '你好', 1)).toBe(1)
    expect(resolveTypewriterAdvanceIndex('你好', '你好世界', 2)).toBe(2)
  })

  it('文本缩短时把游标夹到新长度', () => {
    expect(resolveTypewriterAdvanceIndex('你好世界', '你好', 4)).toBe(2)
  })

  it('文本分叉时回退到公共前缀', () => {
    expect(resolveTypewriterAdvanceIndex('你好啊', '你好呀', 3)).toBe(2)
  })

  it('空串与越界游标安全处理', () => {
    expect(resolveTypewriterAdvanceIndex('', 'abc', 0)).toBe(0)
    expect(resolveTypewriterAdvanceIndex('abc', '', 2)).toBe(0)
    expect(resolveTypewriterAdvanceIndex('a', 'ab', 99)).toBe(2)
  })
})
