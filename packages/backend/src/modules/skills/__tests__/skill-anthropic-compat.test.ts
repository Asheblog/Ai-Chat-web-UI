import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildAnthropicCompatManifest, parseSkillMarkdown } from '../skill-anthropic-compat'

describe('skill-anthropic-compat', () => {
  it('parses SKILL.md frontmatter', () => {
    const parsed = parseSkillMarkdown(`---
name: pptx
description: Slide workflow
---
# PPTX

hello`)
    expect(parsed.frontmatter).toEqual({
      name: 'pptx',
      description: 'Slide workflow',
    })
    expect(parsed.body).toContain('# PPTX')
  })

  it('builds compat manifest from SKILL.md and executes generated runner', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-skill-compat-'))
    try {
      await fs.writeFile(
        path.join(tempDir, 'SKILL.md'),
        `---
name: pptx
description: Use for presentation creation and editing
---
# PPTX Skill

Read editing.md before changing existing decks.
`,
        'utf8',
      )
      await fs.writeFile(path.join(tempDir, 'editing.md'), '# Editing\n\nTemplate-safe edit flow.', 'utf8')

      const built = await buildAnthropicCompatManifest({
        extractedDir: tempDir,
        source: {
          owner: 'anthropics',
          repo: 'skills',
          ref: 'main',
          subdir: 'skills/pptx',
        },
      })

      expect(built).not.toBeNull()
      expect(built?.manifest.id).toBe('pptx')
      expect(built?.manifest.entry).toBe('.aichat/anthropic-skill-runner.mjs')
      expect(built?.manifest.tools).toHaveLength(1)
      expect(built?.manifest.runtime.type).toBe('node')

      const runnerPath = path.join(tempDir, built!.manifest.entry)
      const runnerStat = await fs.stat(runnerPath)
      expect(runnerStat.isFile()).toBe(true)

      const run = spawnSync(process.execPath, [runnerPath], {
        cwd: tempDir,
        env: {
          ...process.env,
          AICHAT_SKILL_PAYLOAD_JSON: JSON.stringify({
            args: {
              task: '编辑现有模板',
              include_files: ['editing.md'],
              max_chars: 4000,
            },
          }),
        },
        encoding: 'utf8',
      })

      expect(run.status).toBe(0)
      expect(run.stderr).toBe('')

      const payload = JSON.parse(run.stdout || '{}')
      expect(payload.ok).toBe(true)
      expect(payload.skill.id).toBe('pptx')
      expect(payload.task).toBe('编辑现有模板')
      expect(typeof payload.guidance).toBe('string')
      expect(payload.referenceFiles).toEqual(expect.arrayContaining(['editing.md']))
      expect(payload.includedFiles['editing.md']).toContain('Template-safe')
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('returns null when SKILL.md is missing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-skill-compat-none-'))
    try {
      const built = await buildAnthropicCompatManifest({
        extractedDir: tempDir,
        source: {
          owner: 'anthropics',
          repo: 'skills',
          ref: 'main',
          subdir: 'skills/pptx',
        },
      })
      expect(built).toBeNull()
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
