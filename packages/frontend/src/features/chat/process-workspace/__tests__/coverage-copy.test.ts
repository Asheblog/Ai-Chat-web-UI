import { describe, expect, it } from 'vitest'
import { describeProcessCoverage, normalizeProcessCoverage } from '../model/coverage'

const texts = (input: Parameters<typeof normalizeProcessCoverage>[0]) =>
  describeProcessCoverage(normalizeProcessCoverage(input)).map((note) => note.text)

describe('coverage presentation', () => {
  it('omits persistence and missing snapshot banners without changing recorded coverage', () => {
    const coverage = normalizeProcessCoverage({
      trace: { status: 'unknown' },
      persisted: { status: 'partial', droppedRecords: 454, truncatedFields: 587 },
      projection: { status: 'complete' },
    })
    expect(describeProcessCoverage(coverage)).toEqual([])
    expect(coverage.persisted).toMatchObject({ status: 'partial', droppedRecords: 454, truncatedFields: 587 })
    expect(coverage.trace.status).toBe('unknown')
  })

  it('omits unknown persistence status', () => {
    expect(texts(undefined)).toEqual([])
  })

  it('retains explicit runtime gaps and positive counts', () => {
    expect(texts({ trace: { status: 'partial', droppedRecords: 8, truncatedFields: 12 } })).toEqual([
      '本次运行链路有缺口：丢弃 8 条记录，裁剪 12 个字段',
    ])
    expect(texts({ trace: { status: 'partial', droppedRecords: 0, truncatedFields: 0 } })).toEqual([
      '本次运行链路有缺口',
    ])
  })

  it('retains the actionable compact-list notice', () => {
    expect(texts({ projection: { status: 'partial' } })).toEqual(['列表视图已精简，打开详情查看'])
  })
})
