'use client'

import { KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { McpField } from './mcp-ui'

/**
 * 连接凭据编辑器：安装模板声明了 requiredEnv 时，按名称逐个填值。
 * 值只走 POST /mcp/connections/:id/credentials 写进 Secret Vault，不在前端拼 JSON。
 */
export interface ConnectionCredentialsProps {
  requiredEnv: string[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  /** 连接已关联凭据：留空表示保持原值 */
  configured: boolean
}

/** 从安装模板的 envJson 里取 requiredEnv；形状不对就当没有要求。 */
export function parseRequiredEnv(envJson?: string | null): string[] {
  if (!envJson) return []
  try {
    const parsed = JSON.parse(envJson)
    const list = parsed?.requiredEnv
    if (!Array.isArray(list)) return []
    return list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

/** 列表里的凭据状态：已配置 / 缺密钥 / 不需要。 */
export function ConnectionCredentialBadge({
  configured,
  requiredEnv,
}: {
  configured: boolean
  requiredEnv: string[]
}): JSX.Element {
  if (configured) return <span className="text-micro text-muted-foreground">已配置</span>
  if (requiredEnv.length > 0) return <span className="text-micro text-destructive">缺密钥</span>
  return <span className="text-micro text-muted-foreground">—</span>
}

export function ConnectionCredentials({
  requiredEnv,
  values,
  onChange,
  configured,
}: ConnectionCredentialsProps): JSX.Element | null {
  if (requiredEnv.length === 0) return null

  return (
    <div className="md:col-span-2 rounded-md border border-border/60 bg-muted/20 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-medium text-foreground">凭据</p>
        <span className="text-micro text-muted-foreground">
          {configured ? '已配置，留空表示保持原值' : '该安装声明了以下密钥'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {requiredEnv.map((name) => (
          <McpField key={name} label={name}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={configured ? '保持原值' : '填写凭据值'}
              value={values[name] ?? ''}
              onChange={(event) => onChange(name, event.target.value)}
            />
          </McpField>
        ))}
      </div>
      <p className="mt-2 text-micro text-muted-foreground">
        值加密存入 Secret Vault，运行层只接收解密后的环境变量，不写入安装模板。
      </p>
    </div>
  )
}
