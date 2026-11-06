import { describe, expect, it } from 'vitest'
import { Virtualizer, type VirtualizerOptions } from '@tanstack/react-virtual'

const buildVirtualizer = (count: number) => {
  const scrollElement = document.createElement('div')
  const options: VirtualizerOptions<HTMLDivElement, HTMLDivElement> = {
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => 100,
    scrollToFn: () => undefined,
    observeElementRect: () => undefined,
    observeElementOffset: () => undefined,
    initialRect: { width: 400, height: 600 },
    getItemKey: (index) => index,
  }
  return new Virtualizer(options)
}

const createRow = (index: number, height: number) => {
  const row = document.createElement('div')
  row.setAttribute('data-index', String(index))
  Object.defineProperty(row, 'offsetHeight', { configurable: true, get: () => height })
  document.body.appendChild(row)
  return row
}

describe('virtualizer same-frame measurement', () => {
  it('keeps every row size when multiple rows are measured in one tick', () => {
    const virtualizer = buildVirtualizer(3)
    // 先建立 measurements cache，再在同一 tick 内批量测量。
    virtualizer.getTotalSize()
    const rows = [createRow(0, 200), createRow(1, 300), createRow(2, 400)]

    for (const row of rows) virtualizer.measureElement(row)

    expect(virtualizer.getTotalSize()).toBe(900)
    expect(virtualizer.measurementsCache.map((item) => item.size)).toEqual([200, 300, 400])
  })

  it('keeps the latest size when the same row is measured twice in one tick', () => {
    const virtualizer = buildVirtualizer(2)
    virtualizer.getTotalSize()
    let height = 180
    const row = document.createElement('div')
    row.setAttribute('data-index', '0')
    Object.defineProperty(row, 'offsetHeight', { configurable: true, get: () => height })
    document.body.appendChild(row)

    virtualizer.measureElement(row)
    height = 260
    virtualizer.measureElement(row)

    expect(virtualizer.getTotalSize()).toBe(360)
    expect(virtualizer.measurementsCache[0]?.size).toBe(260)
  })
})
