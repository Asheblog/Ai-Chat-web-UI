import { describe, expect, it } from 'vitest'
import {
  buildBrandThemeCssAssignments,
  hexToHslComponents,
  isValidBrandHex,
  normalizeBrandHex,
} from '@aichat/shared'

describe('brand-theme helpers', () => {
  it('normalizes and validates #RRGGBB', () => {
    expect(isValidBrandHex('#aabbcc')).toBe(true)
    expect(isValidBrandHex(' #AABBCC ')).toBe(true)
    expect(isValidBrandHex('#abc')).toBe(false)
    expect(isValidBrandHex('red')).toBe(false)
    expect(normalizeBrandHex(' #aabbcc ')).toBe('#AABBCC')
    expect(normalizeBrandHex('')).toBeNull()
    expect(normalizeBrandHex(null)).toBeNull()
  })

  it('converts hex to HSL components', () => {
    expect(hexToHslComponents('#000000')).toBe('0 0% 0%')
    expect(hexToHslComponents('#FFFFFF')).toBe('0 0% 100%')
    expect(hexToHslComponents('bad')).toBeNull()
  })

  it('builds CSS variable assignments for configured colors', () => {
    const assignments = buildBrandThemeCssAssignments({
      brand_primary: '#C96A3A',
      brand_background: '',
      brand_foreground: '#241C16',
    })
    const names = assignments.map((item) => item.name)
    expect(names).toContain('--primary')
    expect(names).toContain('--primary-hover')
    expect(names).toContain('--foreground')
    expect(names).not.toContain('--background')
    expect(assignments.find((a) => a.name === '--foreground')?.lightOnly).toBe(true)
    expect(assignments.find((a) => a.name === '--primary')?.lightOnly).toBeFalsy()
  })
})
