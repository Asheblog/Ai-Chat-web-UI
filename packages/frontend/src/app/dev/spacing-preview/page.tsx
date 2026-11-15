import { notFound } from 'next/navigation'
import { SpacingPreview } from './spacing-preview'

export default function SpacingPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <SpacingPreview />
}
