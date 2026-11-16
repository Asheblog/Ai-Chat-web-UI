import { PrismaClient } from '@prisma/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateSimplifiedSettings } from './settings-migration'

describe('settings simplification upgrade', () => {
  it.each([
    { enabled: '[" EXA ","tavily","exa"]', order: 'tavily,EXA', expected: ['tavily', 'exa'] },
    { enabled: '[]', order: 'EXA,tavily', expected: ['tavily'] },
  ])('migrates environment-only engine settings: $enabled', async ({ enabled, order, expected }) => {
    const dir = await mkdtemp(join(tmpdir(), 'aichat-settings-env-'))
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + join(dir, 'settings.db').replace(/\\/g, '/') } } })
    try {
      await db.$executeRawUnsafe('CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      await migrateSimplifiedSettings(db, { WEB_SEARCH_ENABLED_ENGINES: enabled, WEB_SEARCH_ENGINE_ORDER: order, WEB_SEARCH_AUTO_BILINGUAL: '0' })
      const settings = Object.fromEntries((await db.systemSetting.findMany()).map(row => [row.key, row.value]))
      expect(JSON.parse(settings.web_search_enabled_engines)).toEqual(expected)
      expect(settings.web_search_auto_bilingual_mode).toBe('off')
    } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }) }
  })

  it('preserves effective search order and bilingual off, removes only retired keys, and runs once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aichat-settings-'))
    const db = new PrismaClient({ datasources: { db: { url: 'file:' + join(dir, 'settings.db').replace(/\\/g, '/') } } })
    try {
      await db.$executeRawUnsafe('CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      for (const [key, value] of Object.entries({
        web_search_enabled_engines: '["tavily","brave","exa"]',
        web_search_engine_order: '["exa","deepseek","tavily"]',
        web_search_auto_bilingual: 'false', web_search_auto_bilingual_mode: 'always',
        assistant_reply_history_limit: '2', provider_max_idle_ms: '100',
        python_tool_timeout_ms: '8000', python_tool_max_output_chars: '900',
        python_tool_max_source_chars: '900', web_search_parallel_merge_strategy: 'hybrid_score_v1',
        anonymous_retention_days: '0', reasoning_max_output_tokens_default: '32000',
        custom_policy: 'kept',
      })) await db.systemSetting.create({ data: { key, value } })
      await migrateSimplifiedSettings(db, {})
      const settings = Object.fromEntries((await db.systemSetting.findMany()).map(row => [row.key, row.value]))
      expect(JSON.parse(settings.web_search_enabled_engines)).toEqual(['exa', 'tavily', 'brave'])
      expect(settings.web_search_auto_bilingual_mode).toBe('off')
      expect(settings).toMatchObject({ anonymous_retention_days: '0', reasoning_max_output_tokens_default: '32000', custom_policy: 'kept' })
      for (const key of ['web_search_engine_order', 'web_search_auto_bilingual', 'assistant_reply_history_limit', 'provider_max_idle_ms', 'python_tool_timeout_ms', 'python_tool_max_output_chars', 'python_tool_max_source_chars', 'web_search_parallel_merge_strategy']) expect(settings).not.toHaveProperty(key)
      await db.systemSetting.update({ where: { key: 'web_search_auto_bilingual_mode' }, data: { value: 'always' } })
      await migrateSimplifiedSettings(db, { WEB_SEARCH_AUTO_BILINGUAL: 'false' })
      expect((await db.systemSetting.findUnique({ where: { key: 'web_search_auto_bilingual_mode' } }))?.value).toBe('always')
    } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }) }
  })
})
