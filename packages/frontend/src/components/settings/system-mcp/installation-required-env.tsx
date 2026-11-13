'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { McpField } from './mcp-ui'

/**
 * 安装模板的「必需环境变量」编辑器：只登记名称，不存值。
 * 连接页据此按名称生成填写框，值由用户在连接处填进 Secret Vault。
 */
export function readRequiredEnv(envJson?: string | null): string[] {
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

/** 写回 requiredEnv，同时保留 envJson 里的其它键（手工填过的原样字段不丢）。 */
export function writeRequiredEnv(envJson: string | undefined, keys: string[]): string {
  let base: Record<string, unknown> = {}
  if (envJson && envJson.trim()) {
    try {
      const parsed = JSON.parse(envJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = { ...parsed }
    } catch {
      base = {}
    }
  }
  const unique = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)))
  if (unique.length > 0) base.requiredEnv = unique
  else delete base.requiredEnv
  return JSON.stringify(base)
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

export interface InstallationRequiredEnvProps {
  value: string
  onChange: (nextEnvJson: string) => void
}

export function InstallationRequiredEnv({ value, onChange }: InstallationRequiredEnvProps): JSX.Element {
  const keys = readRequiredEnv(value)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const name = draft.trim().toUpperCase()
    if (!name) return
    if (!ENV_NAME.test(name)) {
      setError('只能使用大写字母、数字与下划线，且以字母开头')
      return
    }
    if (keys.includes(name)) {
      setError('该变量已在列表中')
      return
    }
    setError(null)
    setDraft('')
    onChange(writeRequiredEnv(value, [...keys, name]))
  }

  const remove = (name: string) => {
    setError(null)
    onChange(writeRequiredEnv(value, keys.filter((item) => item !== name)))
  }

  return (
    <McpField label="必需环境变量">
      <div className="space-y-2">
        {keys.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {keys.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-micro font-mono"
              >
                {name}
                <button
                  type="button"
                  onClick={() => remove(name)}
                  aria-label={`移除 ${name}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-micro text-muted-foreground">还没有声明必填变量，连接页不会显示填写框。</p>
        )}
        <div className="flex gap-1">
          <Input
            value={draft}
            aria-label="必需环境变量名称"
            placeholder="如 GITHUB_TOKEN"
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={add}>
            添加
          </Button>
        </div>
        {error ? <p className="text-micro text-destructive">{error}</p> : null}
        <p className="text-micro text-muted-foreground">只写名称，不写值；值在连接页填写并加密存入 Secret Vault。</p>
      </div>
    </McpField>
  )
}
