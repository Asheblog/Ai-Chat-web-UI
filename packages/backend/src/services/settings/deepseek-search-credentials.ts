import type { PrismaClient, Prisma } from '@prisma/client'
import type { SecretVaultService } from '../secret-vault'

export const DEEPSEEK_SEARCH_SECRET_SETTING = 'web_search_deepseek_secret_id'

type Vault = Pick<SecretVaultService, 'encrypt' | 'getSecretView' | 'decryptById'>

const assertSearchSecret = (secret: { scope: string; scopeId: string; kind: string; refType: string | null; refId: string | null } | null) => {
  if (!secret || secret.scope !== 'system' || secret.scopeId !== 'system' || secret.kind !== 'api_key' || secret.refType !== 'web_search' || secret.refId !== 'deepseek') {
    throw new Error('DeepSeek 搜索凭据不存在或不属于系统搜索能力')
  }
}

const parseSecretId = (value: string): number => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('DeepSeek 搜索凭据引用无效')
  return id
}

/** 密钥与引用在同一事务中写入；不向通用 SystemSetting 保存明文。 */
export async function saveDeepseekSearchKey(prisma: PrismaClient, vault: Vault, value: string): Promise<void> {
  const key = value.trim()
  const encryptedValue = key ? vault.encrypt(key) : undefined
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const setting = await tx.systemSetting.findUnique({ where: { key: DEEPSEEK_SEARCH_SECRET_SETTING } })
    let id: number | undefined
    const candidate = Number(setting?.value)
    if (Number.isSafeInteger(candidate) && candidate > 0) {
      const existing = await tx.secretVault.findUnique({ where: { id: candidate } })
      try {
        assertSearchSecret(existing)
        id = candidate
      } catch {
        // 管理员可以修复损坏引用；不触碰不属于搜索能力的凭据。
      }
    }
    if (encryptedValue) {
      if (id) {
        await tx.secretVault.update({ where: { id }, data: { encryptedValue } })
      } else {
        const record = await tx.secretVault.create({ data: { scope: 'system', scopeId: 'system', kind: 'api_key', label: 'DeepSeek 联网搜索', refType: 'web_search', refId: 'deepseek', encryptedValue } })
        id = record.id
      }
    } else if (id) {
      await tx.secretVault.delete({ where: { id } })
      id = undefined
    }
    const reference = id ? String(id) : ''
    await tx.systemSetting.upsert({ where: { key: DEEPSEEK_SEARCH_SECRET_SETTING }, create: { key: DEEPSEEK_SEARCH_SECRET_SETTING, value: reference }, update: { value: reference } })
  })
}

export async function hasDeepseekSearchKey(settings: Record<string, string>, vault?: Vault, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const reference = settings[DEEPSEEK_SEARCH_SECRET_SETTING]
  if (!reference) return Boolean(env.WEB_SEARCH_API_KEY_DEEPSEEK?.trim())
  if (!vault) return false
  try {
    const view = await vault.getSecretView(parseSecretId(reference))
    assertSearchSecret(view)
    return view.hasValue
  } catch {
    return false
  }
}

/** 只返回工具配置私有快照，不修改会被记录的会话/系统设置。 */
export async function resolveDeepseekSearchSettings(settings: Record<string, string>, vault?: Vault, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const reference = settings[DEEPSEEK_SEARCH_SECRET_SETTING]
  let key = env.WEB_SEARCH_API_KEY_DEEPSEEK?.trim() || ''
  if (reference) {
    try {
      if (!vault) throw new Error('Search vault unavailable')
      const id = parseSecretId(reference)
      assertSearchSecret(await vault.getSecretView(id))
      key = (await vault.decryptById(id)).trim()
      if (!key) throw new Error('Empty credential')
    } catch {
      // 只停用损坏的搜索凭据，避免阻断普通聊天或其它搜索引擎。
      console.warn('[DeepSeekSearch] 搜索凭据无法读取，请管理员重新配置')
      key = ''
    }
  }
  return { ...settings, web_search_api_key_deepseek: key }
}
