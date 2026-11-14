import { notFound } from 'next/navigation'
import { RedesignPreview } from './redesign-preview'

export default function RedesignPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <RedesignPreview />
}
