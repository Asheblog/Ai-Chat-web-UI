/** Brand theme color fields stored as #RRGGBB (empty = use default Claude theme). */

export const BRAND_THEME_STORAGE_KEYS = [
  'brand_primary',
  'brand_primary_foreground',
  'brand_background',
  'brand_surface',
  'brand_foreground',
  'brand_muted_foreground',
] as const

export type BrandThemeStorageKey = (typeof BRAND_THEME_STORAGE_KEYS)[number]

export type BrandThemeColors = Partial<Record<BrandThemeStorageKey, string | null | undefined>>

export const BRAND_THEME_CSS_VAR_MAP: Record<BrandThemeStorageKey, string[]> = {
  brand_primary: ['--primary', '--ring', '--sidebar-active', '--accent-color'],
  brand_primary_foreground: ['--primary-foreground'],
  brand_background: ['--background', '--background-alt'],
  brand_surface: ['--surface', '--card', '--popover'],
  brand_foreground: ['--foreground', '--card-foreground', '--popover-foreground'],
  brand_muted_foreground: ['--muted-foreground'],
}

/** Paper / text surface vars — apply only in light mode so warm dark defaults stay intact. */
const LIGHT_ONLY_KEYS = new Set<BrandThemeStorageKey>([
  'brand_background',
  'brand_surface',
  'brand_foreground',
  'brand_muted_foreground',
])

const BRAND_THEME_STYLE_ID = 'aichat-brand-theme-overrides'

const HEX_RE = /^#([0-9a-fA-F]{6})$/

export function isValidBrandHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim())
}

export function normalizeBrandHex(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!HEX_RE.test(trimmed)) return null
  return trimmed.toUpperCase()
}

/** Convert #RRGGBB to CSS HSL components without `hsl()` wrapper (e.g. `18 65% 52%`). */
export function hexToHslComponents(hex: string): string | null {
  const normalized = normalizeBrandHex(hex)
  if (!normalized) return null
  const r = Number.parseInt(normalized.slice(1, 3), 16) / 255
  const g = Number.parseInt(normalized.slice(3, 5), 16) / 255
  const b = Number.parseInt(normalized.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      default:
        h = ((r - g) / d + 4) / 6
        break
    }
  }
  const H = Math.round(h * 360)
  const S = Math.round(s * 100)
  const L = Math.round(l * 100)
  return `${H} ${S}% ${L}%`
}

/** Darken HSL components for hover (reduce lightness by ~7 points). */
export function darkenHslComponents(components: string, delta = 7): string {
  const match = components.match(/^(\d+)\s+(\d+)%\s+(\d+)%$/)
  if (!match) return components
  const h = Number(match[1])
  const s = Number(match[2])
  const l = Math.max(0, Number(match[3]) - delta)
  return `${h} ${s}% ${l}%`
}

export type BrandThemeCssAssignment = { name: string; value: string; lightOnly?: boolean }

export function buildBrandThemeCssAssignments(
  theme: BrandThemeColors,
): BrandThemeCssAssignment[] {
  const assignments: BrandThemeCssAssignment[] = []
  for (const key of BRAND_THEME_STORAGE_KEYS) {
    const hsl = hexToHslComponents(theme[key] ?? '')
    if (!hsl) continue
    const lightOnly = LIGHT_ONLY_KEYS.has(key)
    for (const cssVar of BRAND_THEME_CSS_VAR_MAP[key]) {
      assignments.push({ name: cssVar, value: hsl, lightOnly })
    }
    if (key === 'brand_primary') {
      assignments.push({ name: '--primary-hover', value: darkenHslComponents(hsl), lightOnly: false })
    }
  }
  return assignments
}

function decls(assignments: BrandThemeCssAssignment[]): string {
  return assignments.map((a) => `${a.name}:${a.value};`).join('')
}

/** Build a CSS stylesheet string that keeps paper overrides out of `.dark`. */
export function buildBrandThemeStylesheet(theme: BrandThemeColors): string {
  const assignments = buildBrandThemeCssAssignments(theme)
  if (assignments.length === 0) return ''
  const both = assignments.filter((a) => !a.lightOnly)
  const light = assignments.filter((a) => a.lightOnly)
  const parts: string[] = []
  if (both.length) {
    parts.push(`:root,.dark{${decls(both)}}`)
  }
  if (light.length) {
    parts.push(`:root:not(.dark){${decls(light)}}`)
  }
  return parts.join('')
}

/**
 * Apply Brand Theme via a dedicated style tag so light paper overrides
 * do not paint over the warm dark companion theme.
 */
export function applyBrandThemeToElement(
  _el: HTMLElement | null | undefined,
  theme: BrandThemeColors,
): void {
  if (typeof document === 'undefined') return
  const css = buildBrandThemeStylesheet(theme)
  let styleEl = document.getElementById(BRAND_THEME_STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    styleEl?.remove()
    return
  }
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = BRAND_THEME_STYLE_ID
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = css
}
