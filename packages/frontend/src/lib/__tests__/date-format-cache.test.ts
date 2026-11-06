import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '@/lib/format'
import { formatDate } from '@/lib/utils'
import {
  DATE_FORMAT_CACHE_LIMIT,
  clearDateFormatCache,
  formatCachedSidebarDateTime,
  getDateFormatCacheSize,
  resetTimeZoneCache,
} from '@/lib/date-format-cache'

describe('date format cache', () => {
  beforeEach(() => {
    clearDateFormatCache()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('formatDateTime reuses the locale result for the same instant', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString')
    const value = new Date(2026, 10, 6, 10, 30, 0)

    const first = formatDateTime(value)
    const second = formatDateTime(value.toISOString())

    expect(second).toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('formatDate caches each relative-time branch without changing cross-day behavior', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0))
    const timeSpy = vi.spyOn(Date.prototype, 'toLocaleTimeString')
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')

    const recent = new Date(2026, 10, 6, 9, 15, 0)
    const recentText = formatDate(recent)
    expect(formatDate(recent)).toBe(recentText)
    expect(timeSpy).toHaveBeenCalledTimes(1)

    const withinWeek = new Date(2026, 10, 4, 9, 0, 0)
    const weekText = formatDate(withinWeek)
    expect(formatDate(withinWeek)).toBe(weekText)
    expect(dateSpy).toHaveBeenCalledTimes(1)

    const older = new Date(2026, 9, 20, 9, 0, 0)
    const olderText = formatDate(older)
    expect(formatDate(older)).toBe(olderText)
    expect(dateSpy).toHaveBeenCalledTimes(2)
    expect(weekText).not.toBe(olderText)
  })

  it('keeps the cache bounded', () => {
    const start = new Date(2020, 0, 1, 0, 0, 0).getTime()
    for (let index = 0; index < DATE_FORMAT_CACHE_LIMIT + 80; index += 1) {
      formatDateTime(new Date(start + index * 86_400_000 + index * 60_000))
    }
    expect(getDateFormatCacheSize()).toBeLessThanOrEqual(DATE_FORMAT_CACHE_LIMIT)
  })

  it('sidebar formatter reuses one result per instant and keeps month/day/time format', () => {
    const value = new Date(2026, 10, 6, 9, 5, 0).getTime()
    const first = formatCachedSidebarDateTime(value)
    const second = formatCachedSidebarDateTime(value)

    expect(second).toBe(first)
    expect(first).toMatch(/\d{2}\/\d{2}\s+\d{2}:\d{2}/)
    expect(getDateFormatCacheSize()).toBe(1)
  })

  it('switches from time to date when the same calendar day crosses 24h', () => {
    vi.useFakeTimers()
    const messageTime = new Date(2026, 10, 5, 11, 0, 0)
    const expectedTime = messageTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    const expectedDate = messageTime.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    const timeSpy = vi.spyOn(Date.prototype, 'toLocaleTimeString')
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')

    vi.setSystemTime(new Date(2026, 10, 6, 10, 0, 0))
    const recent = formatDate(messageTime)
    expect(recent).toBe(expectedTime)
    expect(timeSpy).toHaveBeenCalledTimes(1)

    // 同一自然日，差值越过 24 小时；缓存必须失效并改用日期文案。
    vi.setSystemTime(new Date(2026, 10, 6, 11, 30, 0))
    const older = formatDate(messageTime)
    expect(older).not.toBe(recent)
    expect(older).toBe(expectedDate)
    expect(dateSpy).toHaveBeenCalledTimes(1)
  })

  it('switches from month/day to year when the same calendar day crosses 7d', () => {
    vi.useFakeTimers()
    const messageTime = new Date(2026, 9, 30, 12, 0, 0)
    const expectedWeek = messageTime.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    const expectedOlder = messageTime.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')

    vi.setSystemTime(new Date(2026, 10, 6, 10, 0, 0))
    const week = formatDate(messageTime)
    expect(week).toBe(expectedWeek)

    vi.setSystemTime(new Date(2026, 10, 6, 13, 0, 0))
    const older = formatDate(messageTime)
    expect(older).not.toBe(week)
    expect(older).toBe(expectedOlder)
    expect(dateSpy).toHaveBeenCalledTimes(2)
  })

  it('constructs Intl at most once across cache hits', () => {
    resetTimeZoneCache()
    const spy = vi.spyOn(Intl, 'DateTimeFormat')
    const value = new Date(2026, 10, 6, 10, 30, 0)

    formatDateTime(value)
    formatDateTime(new Date(2026, 10, 6, 10, 31, 0))

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('keeps sidebar formatter for cache hits and rebuilds after invalidation', () => {
    resetTimeZoneCache()
    const value = new Date(2026, 10, 6, 10, 30, 0)
    const first = formatCachedSidebarDateTime(value.getTime())

    const spy = vi.spyOn(Intl, 'DateTimeFormat')
    expect(formatCachedSidebarDateTime(value.getTime())).toBe(first)
    expect(spy).not.toHaveBeenCalled()

    resetTimeZoneCache()
    expect(formatCachedSidebarDateTime(value.getTime())).toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
