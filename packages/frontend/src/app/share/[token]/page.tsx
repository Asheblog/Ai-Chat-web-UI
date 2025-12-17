import { notFound } from 'next/navigation'
import { fetchSharedConversation } from '@/lib/server-share'
import { getServerBranding } from '@/lib/server-branding'
import { ShareViewer } from '@/components/share/share-viewer'

interface SharePageProps {
  params: { token: string }
}

export const revalidate = 0

export default async function SharePage({ params }: SharePageProps) {
  const token = params?.token || ''
  const [share, branding] = await Promise.all([
    fetchSharedConversation(token),
    getServerBranding(),
  ])
  if (!share) {
    notFound()
  }
  return <ShareViewer share={share} brandText={branding.text} />
}
