/**
 * Rich Message Payload 类型 —— backend / frontend 共用。
 *
 * 收敛 backend types/index.ts 与 frontend types/index.ts 两份重复定义。
 */

export type RichMessageLayout = 'auto' | 'side-by-side' | 'stack'
export type RichMessageImageSource = 'generated' | 'attachment' | 'external'
export type RichMessageEvidenceKind = 'web' | 'document' | 'generated' | 'upload' | 'unknown'
export type RichMessageEvidenceConfidence = 'high' | 'medium' | 'low'

export interface RichMessageTextPart {
  type: 'text'
  text: string
  format: 'markdown'
}

export interface RichMessageImagePart {
  type: 'image'
  url: string
  source: RichMessageImageSource
  sourceKind?: RichMessageEvidenceKind
  alt?: string
  width?: number | null
  height?: number | null
  title?: string
  sourceUrl?: string
  sourceLabel?: string
  confidence?: RichMessageEvidenceConfidence
  refId?: string
  meta?: Record<string, unknown>
}

export type RichMessagePart = RichMessageTextPart | RichMessageImagePart

export interface RichMessagePayload {
  layout: RichMessageLayout
  parts: RichMessagePart[]
}
