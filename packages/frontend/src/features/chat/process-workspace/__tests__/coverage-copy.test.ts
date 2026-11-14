import { describe, expect, it } from 'vitest'
import { describeProcessCoverage, normalizeProcessCoverage } from '../model/coverage'

const coverageOf = (input: Parameters<typeof normalizeProcessCoverage>[0]) =>
  describeProcessCoverage(normalizeProcessCoverage(input))

const texts = (input: Parameters<typeof normalizeProcessCoverage>[0]) =>
  coverageOf(input).map((note) => note.text)

const noteOf = (input: Parameters<typeof normalizeProcessCoverage>[0], layer: 'trace' | 'persisted' | 'projection') =>
  coverageOf(input).find((note) => note.layer === layer)?.text ?? null

describe('覆盖文案：不写没有确证的计量', () => {
  it('丢记录/裁剪字段为 0 时不显示计量', () => {
    const notes = texts({
      trace: { status: 'complete' },
      persisted: { status: 'partial', droppedRecords: 0, truncatedFields: 0 },
      projection: { status: 'complete' },
    })
    expect(notes.join('')).not.toMatch(/0 条记录|0 个字段/)
    expect(notes).toContain('持久化记录尚不完整')
  })

  it('没有正计数时不凭空断言已丢失', () => {
    const input = { persisted: { status: 'partial' } } as const
    expect(noteOf(input, 'persisted')).toBe('持久化记录尚不完整')
    expect(texts(input).join('')).not.toMatch(/丢弃|丢失/)
  })

  it('有正计数时才写具体数字', () => {
    const notes = texts({ persisted: { status: 'partial', droppedRecords: 454, truncatedFields: 12 } })
    expect(notes[0]).toBe('持久化记录不完整：丢弃 454 条记录，裁剪 12 个字段')
  })

  it('只有丢记录、没有裁剪字段时只写丢记录', () => {
    expect(noteOf({ persisted: { status: 'partial', droppedRecords: 8 } }, 'persisted')).toBe(
      '持久化记录不完整：丢弃 8 条记录',
    )
  })

  it('trace unknown 只说没有快照，不声称运行结束（流式中也会 unknown）', () => {
    const input = {
      trace: { status: 'unknown' },
      persisted: { status: 'complete' },
      projection: { status: 'complete' },
    } as const
    expect(texts(input)).toEqual(['无原始运行链路快照'])
    expect(texts(input).join('')).not.toMatch(/已结束|结束/)
  })

  it('trace partial 无正计数时只说有缺口', () => {
    expect(texts({ trace: { status: 'partial' }, persisted: { status: 'complete' }, projection: { status: 'complete' } })).toEqual([
      '本次运行链路有缺口',
    ])
  })

  it('projection partial 说明列表视图精简，不表述成记录丢失', () => {
    const notes = texts({
      trace: { status: 'complete' },
      persisted: { status: 'complete' },
      projection: { status: 'partial' },
    })
    expect(notes).toEqual(['列表视图已精简，打开详情查看'])
    expect(notes.join('')).not.toMatch(/丢失|不完整/)
  })
})
