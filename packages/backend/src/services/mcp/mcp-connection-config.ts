/** MCP 连接配置的解析工具：运行层与服务层共用同一份形状，避免两处各写一遍。 */

/** 运行层消费的连接切面：安装模板 + 连接配置合并后的最小字段集。 */
export interface McpRuntimeConnection {
  id: number
  transport?: string
  endpoint?: string | null
  command?: string | null
  args?: string[] | null
  configJson?: string
  secretVaultId?: number | null
}

/** 密钥库里 MCP 凭据的约定形状：{ env, headers }，解不开就明确失败，不静默降级为无凭据。 */
export function parseMcpVaultSecrets(raw: string): {
  env: Record<string, string>
  headers: Record<string, string>
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('MCP 凭据内容不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('MCP 凭据内容必须是 { env, headers } 对象')
  }
  const record = parsed as Record<string, unknown>
  return { env: pickStringRecord(record.env), headers: pickStringRecord(record.headers) }
}

export function parseMcpConfigJson(configJson?: string | null): Record<string, any> {
  if (!configJson) return {}
  try {
    const parsed = JSON.parse(configJson)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 参数优先取连接上的 args，其次取 configJson.args；都不是数组则为空。 */
export function parseMcpArgs(raw: string[] | null | undefined, configJson?: string | null): string[] {
  if (Array.isArray(raw) && raw.length > 0) return raw.map(String)
  const nested = parseMcpConfigJson(configJson).args
  return Array.isArray(nested) ? nested.map(String) : []
}

/** 安装模板里的 argsJson（JSON 数组字符串）→ string[]；解析失败返回 null。 */
export function parseMcpArgsJson(raw?: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : null
  } catch {
    return null
  }
}

export function pickStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}
