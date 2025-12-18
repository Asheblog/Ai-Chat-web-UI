'use client'

import { apiHttpClient } from '@/lib/api'
import type { ApiResponse } from '@/types'

export type SetupState = 'required' | 'skipped' | 'completed'

export type SetupStatusDiagnostics = {
  hasEnabledSystemConnection: boolean
  enabledSystemConnections: number
  totalSystemConnections: number
  hasChatModels: boolean
  chatModels: number
  totalModels: number
  securityWarnings: {
    jwtSecretUnsafe: boolean
    encryptionKeyUnsafe: boolean
  }
}

export type SetupStatusResponse =
  | {
      setup_state: SetupState
      requires_admin: true
    }
  | {
      setup_state: SetupState
      stored_state: SetupState | null
      forced_by_env: boolean
      can_complete: boolean
      diagnostics: SetupStatusDiagnostics
    }

const client = apiHttpClient

export const getSetupStatus = async () => {
  const response = await client.get<ApiResponse<SetupStatusResponse>>(
    '/settings/setup-status',
  )
  return response.data
}

export const setSetupState = async (state: 'skipped' | 'completed') => {
  const response = await client.post<ApiResponse<{ setup_state: SetupState }>>(
    '/settings/setup-state',
    { state },
  )
  return response.data
}

