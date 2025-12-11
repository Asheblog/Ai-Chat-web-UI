export interface ImageLimits {
  maxCount: number
  maxMb: number
  maxEdge: number
  maxTotalMb: number
}

export interface ComposerImage {
  dataUrl: string
  mime: string
  size: number
}

export type ToastHandler = (payload: {
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}) => void
