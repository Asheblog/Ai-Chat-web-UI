import { redirect } from 'next/navigation'
import { ChatPageClient } from '../chat-page-client'

interface SessionPageProps {
  params: { sessionId?: string }
}

export const dynamic = 'force-dynamic'

export default function SessionPage({ params }: SessionPageProps) {
  const raw = params?.sessionId
  if (!raw) {
    redirect('/main')
  }
  const parsed = Number(raw)
  const normalized = Number.isFinite(parsed) ? parsed : null
  if (normalized === null) {
    redirect('/main')
  }
  return <ChatPageClient initialSessionId={normalized} />
}
