import { isIP } from 'node:net'

const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

const expandIPv6 = (ip: string): number[] | null => {
  const withoutZone = ip.split('%')[0] || ''
  if (!withoutZone.includes(':')) return null

  let normalized = withoutZone
  const lastColon = normalized.lastIndexOf(':')
  const tail = normalized.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = tail.split('.').map((part) => Number.parseInt(part, 10))
    if (v4.length !== 4 || v4.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
      return null
    }
    const high = ((v4[0] << 8) | v4[1]).toString(16)
    const low = ((v4[2] << 8) | v4[3]).toString(16)
    normalized = normalized.slice(0, lastColon + 1) + high + ':' + low
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const parseGroups = (value: string): number[] | null => {
    if (!value) return []
    const groups = value.split(':')
    const parsed: number[] = []
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
      parsed.push(Number.parseInt(group, 16))
    }
    return parsed
  }

  const head = parseGroups(halves[0])
  const rest = halves.length === 2 ? parseGroups(halves[1]) : []
  if (!head || !rest) return null
  const missing = 8 - head.length - rest.length
  if (halves.length === 1) {
    return head.length === 8 ? head : null
  }
  if (missing < 0) return null
  return [...head, ...Array.from({ length: missing }, () => 0), ...rest]
}

const ipv4FromGroups = (groups: number[]): string =>
  [groups[0] >> 8, groups[0] & 0xff, groups[1] >> 8, groups[1] & 0xff].join('.')

const isPrivateIPv6 = (ip: string): boolean => {
  const groups = expandIPv6(ip)
  if (!groups) return false

  if (groups.every((group) => group === 0)) return true
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true

  const first = groups[0]
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  if ((first & 0xff00) === 0xff00) return true

  const embeddedIPv4Prefix =
    groups.slice(0, 5).every((group) => group === 0) &&
    (groups[5] === 0xffff || groups[5] === 0)
  if (embeddedIPv4Prefix) {
    const embedded = ipv4FromGroups([groups[6], groups[7]])
    if (isPrivateIPv4(embedded)) return true
  }

  return false
}

export const normalizeHostname = (hostname: string): string => {
  let normalized = (hostname || '').trim().toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  const zoneIndex = normalized.indexOf('%')
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex)
  return normalized.replace(/\.+$/, '')
}

export const isDisallowedHostname = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true
  }

  const version = isIP(normalized)
  if (version === 4) return isPrivateIPv4(normalized)
  if (version === 6) return isPrivateIPv6(normalized)
  return false
}
