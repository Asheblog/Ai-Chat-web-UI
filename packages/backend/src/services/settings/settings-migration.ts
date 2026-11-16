import type { PrismaClient } from '@prisma/client'
import { normalizeWebSearchEngines } from '@aichat/shared/web-search-contract'

const MIGRATION_KEY = 'settings_simplification_20261116'
const RETIRED_KEYS = [
  'assistant_reply_history_limit', 'provider_max_idle_ms',
  'python_tool_timeout_ms', 'python_tool_max_output_chars', 'python_tool_max_source_chars',
  'web_search_engine_order', 'web_search_auto_bilingual', 'web_search_parallel_merge_strategy',
]

/** One atomic upgrade before requests or background consumers read settings. */
export async function migrateSimplifiedSettings(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await prisma.$transaction(async tx => {
    if (await tx.systemSetting.findUnique({ where: { key: MIGRATION_KEY } })) return
    const values = Object.fromEntries((await tx.systemSetting.findMany()).map(row => [row.key, row.value]))
    const save = (key: string, value: string) => tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
    const legacyOrder = values.web_search_engine_order ?? env.WEB_SEARCH_ENGINE_ORDER
    if (legacyOrder !== undefined) {
      const enabled = normalizeWebSearchEngines(
        values.web_search_enabled_engines ?? env.WEB_SEARCH_ENABLED_ENGINES,
        ['tavily'],
      )
      const order = normalizeWebSearchEngines(legacyOrder, enabled)
      const merged = [...order.filter(engine => enabled.includes(engine)), ...enabled.filter(engine => !order.includes(engine))]
      await save('web_search_enabled_engines', JSON.stringify(merged))
    }
    const oldBilingual = values.web_search_auto_bilingual ?? env.WEB_SEARCH_AUTO_BILINGUAL
    if (oldBilingual?.trim().toLowerCase() === 'false' || oldBilingual?.trim() === '0') {
      await save('web_search_auto_bilingual_mode', 'off')
    }
    await tx.systemSetting.deleteMany({ where: { key: { in: RETIRED_KEYS } } })
    await save(MIGRATION_KEY, '1')
  })
}
