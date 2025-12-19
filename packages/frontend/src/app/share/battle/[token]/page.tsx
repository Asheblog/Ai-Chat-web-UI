import { notFound } from 'next/navigation'
import { fetchBattleShare } from '@/lib/server-battle-share'
import { getServerBranding } from '@/lib/server-branding'
import { BattleShareViewer } from '@/components/share/battle-share-viewer'

interface BattleSharePageProps {
  params: { token: string }
}

export const revalidate = 0

export default async function BattleSharePage({ params }: BattleSharePageProps) {
  const token = params?.token || ''
  const [share, branding] = await Promise.all([
    fetchBattleShare(token),
    getServerBranding(),
  ])
  if (!share) {
    notFound()
  }
  return <BattleShareViewer share={share} brandText={branding.text} />
}
