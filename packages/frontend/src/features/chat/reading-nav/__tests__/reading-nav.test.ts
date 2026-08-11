import { describe, expect, it } from 'vitest'
import {
  buildTurnOwnership,
  buildTurnTocEntries,
  parseReadingAnchorStore,
  resolveActiveTurnKey,
  serializeReadingAnchorStore,
  shouldShowTurnToc,
  truncateTurnLabel,
  type ReadingAnchorStore,
  type TurnTocEntry,
} from '../index'

describe('truncateTurnLabel', () => {
  it('短文本原样返回', () => {
    expect(truncateTurnLabel('可以30个字')).toBe('可以30个字')
  })

  it('超长文本截断并加省略号', () => {
    expect(truncateTurnLabel('精简优化这段话不超20个字然后继续补充说明')).toBe(
      '精简优化这段话不超20个字然后继续补充说…',
    )
  })

  it('折叠空白为一空格再截断', () => {
    expect(truncateTurnLabel('  你好\n\n世界  ')).toBe('你好 世界')
  })
})

describe('buildTurnTocEntries', () => {
  it('只为用户轮与压缩组生成目录项，助手不单独占项', () => {
    const entries = buildTurnTocEntries(
      [
        { id: 1, stableKey: 'u1', role: 'user' },
        { id: 2, stableKey: 'a1', role: 'assistant' },
        { id: 3, stableKey: 'u2', role: 'user' },
        { id: 4, stableKey: 'a2', role: 'assistant' },
      ],
      {
        '1': { content: '精简优化这段话不超20个字然后继续补充说明' },
        '2': { content: '助手回复一' },
        '3': { content: '可以30个字' },
        '4': { content: '助手回复二' },
      },
    )

    expect(entries).toEqual<TurnTocEntry[]>([
      { key: 'u1', messageId: 1, label: '精简优化这段话不超20个字然后继续补充说…' },
      { key: 'u2', messageId: 3, label: '可以30个字' },
    ])
  })

  it('空文本与图片/压缩组使用占位文案', () => {
    const entries = buildTurnTocEntries(
      [
        { id: 10, stableKey: 'img', role: 'user', images: ['a.png'] },
        { id: 11, stableKey: 'empty', role: 'user' },
        { id: 12, stableKey: 'zip', role: 'compressedGroup' },
      ],
      {
        '10': { content: '   ' },
        '11': { content: '' },
        '12': { content: '旧对话摘要' },
      },
    )

    expect(entries.map((e) => e.label)).toEqual(['图片消息', '空消息', '已压缩对话'])
  })
})

describe('shouldShowTurnToc', () => {
  it('用户轮不足 3 且不可滚动时不显示', () => {
    expect(
      shouldShowTurnToc(
        [
          { key: 'u1', messageId: 1, label: 'a' },
          { key: 'u2', messageId: 2, label: 'b' },
        ],
        { scrollable: false },
      ),
    ).toBe(false)
  })

  it('用户轮 ≥3 时显示', () => {
    expect(
      shouldShowTurnToc(
        [
          { key: 'u1', messageId: 1, label: 'a' },
          { key: 'u2', messageId: 2, label: 'b' },
          { key: 'u3', messageId: 3, label: 'c' },
        ],
        { scrollable: false },
      ),
    ).toBe(true)
  })

  it('可滚动且至少 2 轮时显示', () => {
    expect(
      shouldShowTurnToc(
        [
          { key: 'u1', messageId: 1, label: 'a' },
          { key: 'u2', messageId: 2, label: 'b' },
        ],
        { scrollable: true },
      ),
    ).toBe(true)
  })
})

describe('buildTurnOwnership + resolveActiveTurnKey', () => {
  it('助手块归属上一用户轮', () => {
    const ownership = buildTurnOwnership([
      { stableKey: 'u1', role: 'user' },
      { stableKey: 'a1', role: 'assistant' },
      { stableKey: 'u2', role: 'user' },
      { stableKey: 'a2', role: 'assistant' },
    ])
    expect(ownership.get('a1')).toBe('u1')
    expect(ownership.get('a2')).toBe('u2')
  })

  it('按视口上 1/3 探测线命中当前轮', () => {
    const entries: TurnTocEntry[] = [
      { key: 'u1', messageId: 1, label: '一' },
      { key: 'u2', messageId: 2, label: '二' },
    ]
    const ownership = new Map([
      ['u1', 'u1'],
      ['a1', 'u1'],
      ['u2', 'u2'],
      ['a2', 'u2'],
    ])
    // viewport: top=0 height=300 → probe at 100
    const positions = [
      { key: 'u1', top: 0, bottom: 80 },
      { key: 'a1', top: 80, bottom: 200 },
      { key: 'u2', top: 200, bottom: 260 },
      { key: 'a2', top: 260, bottom: 400 },
    ]

    expect(resolveActiveTurnKey(entries, ownership, positions, { viewportTop: 0, viewportHeight: 300 })).toBe(
      'u1',
    )
    expect(resolveActiveTurnKey(entries, ownership, positions, { viewportTop: 150, viewportHeight: 300 })).toBe(
      'u2',
    )
  })
})

describe('ReadingAnchor store', () => {
  it('读写 session 锚点，忽略非法值', () => {
    const raw = JSON.stringify({
      '12': { messageKey: 'u-abc' },
      bad: { messageKey: 1 },
      '13': { messageKey: '' },
      '14': { scrollTop: 99 },
    })
    const parsed = parseReadingAnchorStore(raw)
    expect(parsed).toEqual<ReadingAnchorStore>({
      12: { messageKey: 'u-abc' },
    })
    expect(JSON.parse(serializeReadingAnchorStore(parsed))).toEqual({
      '12': { messageKey: 'u-abc' },
    })
  })
})
