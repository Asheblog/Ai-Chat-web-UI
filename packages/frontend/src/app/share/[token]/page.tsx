import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { fetchSharedConversation, fetchSharedConversationMessages } from '@/lib/server-share'
import { getServerBranding } from '@/lib/server-branding'
import { ShareViewer } from '@/components/share/share-viewer'

interface SharePageProps {
  params: { token: string }
}

export const revalidate = 0

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const token = params?.token || ''
  const [share, branding] = await Promise.all([
    fetchSharedConversation(token),
    getServerBranding(),
  ])
  if (!share) {
    return {
      title: '分享不存在',
      description: '该分享已失效或不存在。',
    }
  }
  const title = `${share.title || share.sessionTitle} - ${branding.text}`
  const description = `共 ${share.messageCount} 条消息的 AI 对话分享`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
    },
  }
}

export default async function SharePage({ params }: SharePageProps) {
  const token = params?.token || ''
  const [share, firstPage, branding] = await Promise.all([
    fetchSharedConversation(token),
    fetchSharedConversationMessages(token, 1, 50),
    getServerBranding(),
  ])
  if (!share || !firstPage) {
    notFound()
  }
  return (
    <ShareViewer
      share={share}
      brandText={branding.text}
      token={token}
      initialMessages={firstPage.messages}
      initialPagination={firstPage.pagination}
    />
  )
}
