import fs from 'node:fs/promises'
import path from 'node:path'

export type SkillLicenseStatus = 'approved' | 'source_available' | 'blocked' | 'unknown'

export interface SkillLicensePolicy {
  fallbackName?: string | null
  fallbackUrl?: string | null
  allowExplicitSourceTerms?: boolean
}

export interface SkillLicenseInfo {
  name: string | null
  url: string | null
  status: SkillLicenseStatus
  installable: boolean
  reason: string
}

const LICENSE_FILE_NAMES = new Set(['license', 'license.txt', 'license.md'])

async function findRootLicenseFile(root: string): Promise<{ fileName: string; content: string } | null> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!LICENSE_FILE_NAMES.has(entry.name.toLowerCase())) continue
    const fullPath = path.join(root, entry.name)
    const content = await fs.readFile(fullPath, 'utf8').catch(() => '')
    return { fileName: entry.name, content }
  }
  return null
}

function classifyLicenseText(text: string, policy?: SkillLicensePolicy): SkillLicenseInfo {
  const normalized = text.replace(/\uFEFF/g, '').trim()
  const lower = normalized.toLowerCase()
  const fallbackName = policy?.fallbackName?.trim() || null
  const fallbackUrl = policy?.fallbackUrl?.trim() || null

  if (!normalized) {
    if (fallbackName) {
      return {
        name: fallbackName,
        url: fallbackUrl,
        status: 'approved',
        installable: true,
        reason: 'source fallback license',
      }
    }
    return {
      name: null,
      url: null,
      status: 'unknown',
      installable: false,
      reason: 'missing explicit license',
    }
  }

  if (
    lower.includes('gnu affero general public license') ||
    lower.includes('gnu general public license') ||
    lower.includes('agpl-') ||
    lower.includes('gpl-')
  ) {
    return {
      name: lower.includes('affero') || lower.includes('agpl') ? 'AGPL/GPL' : 'GPL',
      url: fallbackUrl,
      status: 'blocked',
      installable: false,
      reason: 'strong copyleft license is disabled by baseline',
    }
  }

  if (
    lower.includes('may not extract') ||
    lower.includes('retain copies of these materials outside') ||
    lower.includes('may not reproduce or copy') ||
    lower.includes('may not create derivative works') ||
    lower.includes('may not distribute')
  ) {
    return {
      name: fallbackName || 'Restricted source terms',
      url: fallbackUrl,
      status: 'blocked',
      installable: false,
      reason: 'license restricts extraction, copying, or redistribution',
    }
  }

  if (lower.includes('apache license') && lower.includes('version 2.0')) {
    return {
      name: 'Apache-2.0',
      url: fallbackUrl || 'https://www.apache.org/licenses/LICENSE-2.0',
      status: 'approved',
      installable: true,
      reason: 'permissive license',
    }
  }

  if (lower.includes('permission is hereby granted, free of charge')) {
    return {
      name: 'MIT',
      url: fallbackUrl || 'https://opensource.org/license/mit',
      status: 'approved',
      installable: true,
      reason: 'permissive license',
    }
  }

  if (lower.includes('bsd license') || lower.includes('redistribution and use in source and binary forms')) {
    return {
      name: 'BSD-style',
      url: fallbackUrl,
      status: 'approved',
      installable: true,
      reason: 'permissive license',
    }
  }

  if (lower.includes('isc license') || lower.includes('isc licence')) {
    return {
      name: 'ISC',
      url: fallbackUrl || 'https://opensource.org/license/isc-license-txt',
      status: 'approved',
      installable: true,
      reason: 'permissive license',
    }
  }

  if (policy?.allowExplicitSourceTerms) {
    return {
      name: fallbackName || 'Explicit source terms',
      url: fallbackUrl,
      status: 'source_available',
      installable: true,
      reason: 'explicit source-available terms allowed by curated baseline',
    }
  }

  return {
    name: fallbackName,
    url: fallbackUrl,
    status: 'unknown',
    installable: false,
    reason: 'license is not recognized by baseline',
  }
}

export async function readSkillLicenseInfo(
  packageRoot: string,
  policy?: SkillLicensePolicy,
): Promise<SkillLicenseInfo> {
  const licenseFile = await findRootLicenseFile(packageRoot)
  if (!licenseFile) {
    return classifyLicenseText('', policy)
  }
  return classifyLicenseText(licenseFile.content, policy)
}

export function fallbackLicenseInfo(policy: SkillLicensePolicy): SkillLicenseInfo {
  return classifyLicenseText('', policy)
}
