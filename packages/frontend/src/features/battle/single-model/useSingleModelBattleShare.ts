'use client'

import { useCallback, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { createBattleShare } from '@/features/battle/api'

export function useSingleModelBattleShare(runId: number | null) {
  const { toast } = useToast()
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copiedShareLink, setCopiedShareLink] = useState(false)

  const resetShareState = useCallback(() => {
    setShareLink(null)
    setCopiedShareLink(false)
  }, [])

  const handleShare = useCallback(async () => {
    if (!runId || sharing) return
    setSharing(true)
    try {
      const res = await createBattleShare(runId)
      if (!res?.success || !res.data) {
        toast({ title: res?.error || '生成分享链接失败', variant: 'destructive' })
        return
      }
      const token = res.data.token
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      const link = `${base}/share/battle/${token}`
      setShareLink(link)
      setCopiedShareLink(false)
      toast({ title: '分享链接已生成' })
    } catch (err: any) {
      toast({ title: err?.message || '生成分享链接失败', variant: 'destructive' })
    } finally {
      setSharing(false)
    }
  }, [runId, sharing, toast])

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopiedShareLink(true)
      toast({ title: '分享链接已复制' })
      window.setTimeout(() => setCopiedShareLink(false), 1800)
    } catch {
      toast({ title: '复制分享链接失败', variant: 'destructive' })
    }
  }, [shareLink, toast])

  return {
    shareLink,
    sharing,
    copiedShareLink,
    setShareLink,
    setCopiedShareLink,
    resetShareState,
    handleShare,
    handleCopyShareLink,
  }
}
