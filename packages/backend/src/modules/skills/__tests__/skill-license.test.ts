import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readSkillLicenseInfo } from '../skill-license'

async function withLicense(content: string | null, run: (dir: string) => Promise<void>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-skill-license-'))
  try {
    if (content != null) {
      await fs.writeFile(path.join(tempDir, 'LICENSE'), content, 'utf8')
    }
    await run(tempDir)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

describe('skill-license', () => {
  it('allows common permissive licenses', async () => {
    await withLicense('MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy', async (dir) => {
      const license = await readSkillLicenseInfo(dir)
      expect(license.installable).toBe(true)
      expect(license.status).toBe('approved')
      expect(license.name).toBe('MIT')
    })

    await withLicense('Apache License\nVersion 2.0, January 2004', async (dir) => {
      const license = await readSkillLicenseInfo(dir)
      expect(license.installable).toBe(true)
      expect(license.name).toBe('Apache-2.0')
    })
  })

  it('blocks strong copyleft licenses', async () => {
    await withLicense('GNU Affero General Public License version 3', async (dir) => {
      const license = await readSkillLicenseInfo(dir)
      expect(license.installable).toBe(false)
      expect(license.status).toBe('blocked')
    })
  })

  it('blocks extraction and redistribution restrictions', async () => {
    await withLicense('You may not extract, reproduce or copy these materials outside the product.', async (dir) => {
      const license = await readSkillLicenseInfo(dir, {
        fallbackName: 'Restricted terms',
        allowExplicitSourceTerms: true,
      })
      expect(license.installable).toBe(false)
      expect(license.status).toBe('blocked')
      expect(license.reason).toContain('restricts')
    })
  })

  it('uses curated fallback license when a package has no root license file', async () => {
    await withLicense(null, async (dir) => {
      const license = await readSkillLicenseInfo(dir, {
        fallbackName: 'MIT',
        fallbackUrl: 'https://example.test/license',
      })
      expect(license.installable).toBe(true)
      expect(license.status).toBe('approved')
      expect(license.url).toBe('https://example.test/license')
    })
  })
})
