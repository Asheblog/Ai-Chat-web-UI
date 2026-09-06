// ─── Secret Vault 相关 DTO ────────────────────────────────────────────────

export interface SecretView {
  id: number
  scope: string
  scopeId: string
  kind: string
  label: string
  hasValue: boolean
  refId: string | null
  refType: string | null
  createdAt: string
  updatedAt: string
}

export interface SecretCreateRequest {
  scope: 'system' | 'user'
  kind: 'api_key' | 'mcp_credential' | 'skill_secret'
  label: string
  value: string
  refType?: string
  refId?: string
}

export interface SecretUpdateRequest {
  label?: string
  kind?: 'api_key' | 'mcp_credential' | 'skill_secret'
  value?: string
  refType?: string | null
  refId?: string | null
}
