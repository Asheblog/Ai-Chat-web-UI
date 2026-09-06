import type { RequestedSkillsPayload } from '../modules/skills/types'

/** Generation inputs, independent of the chat HTTP request schema. */
export interface RequestGenerationOptions {
  contextEnabled?: boolean
  reasoningEnabled?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh'
  ollamaThink?: boolean
  skills?: Partial<RequestedSkillsPayload>
  custom_body?: Record<string, unknown>
  custom_headers?: Array<{ name: string; value: string }>
}
