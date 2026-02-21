'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { listSkillApprovals, respondSkillApproval } from '@/features/skills/api'
import { useAuthStore } from '@/store/auth-store'
import type { ChatStreamChunk, SkillApprovalRequestItem } from '@/types'

const SKILL_APPROVAL_EVENT = 'aichat:skill-approval'

const mergeApprovalQueue = (
  current: SkillApprovalRequestItem[],
  incoming: SkillApprovalRequestItem,
) => {
  const idx = current.findIndex((item) => item.id === incoming.id)
  if (idx === -1) {
    return [incoming, ...current].sort((a, b) => {
      const ta = new Date(a.requestedAt || 0).getTime()
      const tb = new Date(b.requestedAt || 0).getTime()
      return tb - ta
    })
  }
  const next = current.slice()
  next[idx] = { ...next[idx], ...incoming }
  return next
}

const fromStreamRequest = (chunk: ChatStreamChunk): SkillApprovalRequestItem | null => {
  if (chunk.type !== 'skill_approval_request') return null
  if (typeof chunk.requestId !== 'number' || !Number.isFinite(chunk.requestId)) return null
  const skillSlug = typeof chunk.skillSlug === 'string' ? chunk.skillSlug : ''
  const skillId = typeof chunk.skillId === 'number' && Number.isFinite(chunk.skillId) ? chunk.skillId : 0
  const versionId =
    typeof chunk.skillVersionId === 'number' && Number.isFinite(chunk.skillVersionId)
      ? chunk.skillVersionId
      : null
  return {
    id: chunk.requestId,
    skillId,
    versionId,
    toolName: typeof chunk.tool === 'string' && chunk.tool.trim() ? chunk.tool : 'unknown',
    toolCallId:
      typeof chunk.toolCallId === 'string' && chunk.toolCallId.trim()
        ? chunk.toolCallId.trim()
        : null,
    status: 'pending',
    reason: typeof chunk.reason === 'string' ? chunk.reason : null,
    requestedByActor: 'stream',
    requestedAt: new Date().toISOString(),
    expiresAt: chunk.expiresAt ?? null,
    skill:
      skillId > 0
        ? {
            id: skillId,
            slug: skillSlug || String(skillId),
            displayName: skillSlug || String(skillId),
          }
        : undefined,
    version:
      versionId != null
        ? {
            id: versionId,
            version: String(versionId),
            status: 'pending',
            riskLevel: null,
          }
        : null,
  }
}

const formatRemaining = (expiresAt: string | Date | null | undefined, nowTick: number) => {
  void nowTick
  if (!expiresAt) return null
  const ts = new Date(expiresAt).getTime()
  if (!Number.isFinite(ts)) return null
  const diffMs = ts - Date.now()
  if (diffMs <= 0) return '已超时'
  const seconds = Math.ceil(diffMs / 1000)
  return `${seconds}s`
}

export function SkillApprovalInbox() {
  const { toast } = useToast()
  const actorState = useAuthStore((state) => state.actorState)
  const user = useAuthStore((state) => state.user)
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'
  const [queue, setQueue] = useState<SkillApprovalRequestItem[]>([])
  const [decisionNote, setDecisionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tick, setTick] = useState(0)

  const active = queue.length > 0 ? queue[0] : null

  useEffect(() => {
    if (!active?.expiresAt) return
    const timer = window.setInterval(() => {
      setTick((value) => value + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active?.id, active?.expiresAt])

  useEffect(() => {
    if (!isAdmin) {
      setQueue([])
      return
    }
    listSkillApprovals({ status: 'pending', limit: 100 })
      .then((response) => {
        if (!response?.success || !Array.isArray(response.data)) return
        const pending = response.data.filter((item) => item.status === 'pending')
        setQueue(pending)
      })
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return

    const handleEvent = (event: Event) => {
      const custom = event as CustomEvent<ChatStreamChunk>
      const chunk = custom.detail
      if (!chunk || typeof chunk !== 'object') return

      if (chunk.type === 'skill_approval_request') {
        const mapped = fromStreamRequest(chunk)
        if (!mapped) return
        setQueue((prev) => mergeApprovalQueue(prev, mapped))
        return
      }

      if (chunk.type === 'skill_approval_result' && typeof chunk.requestId === 'number') {
        setQueue((prev) => prev.filter((item) => item.id !== chunk.requestId))
        const decision =
          chunk.decision === 'approved' || chunk.decision === 'denied' || chunk.decision === 'expired'
            ? chunk.decision
            : 'expired'
        const title =
          decision === 'approved'
            ? '技能审批已通过'
            : decision === 'denied'
              ? '技能审批被拒绝'
              : '技能审批已超时'
        toast({
          title,
          description:
            typeof chunk.skillSlug === 'string' && chunk.skillSlug.trim()
              ? `Skill: ${chunk.skillSlug}`
              : undefined,
          variant: decision === 'approved' ? 'default' : 'destructive',
        })
      }
    }

    window.addEventListener(SKILL_APPROVAL_EVENT, handleEvent as EventListener)
    return () => {
      window.removeEventListener(SKILL_APPROVAL_EVENT, handleEvent as EventListener)
    }
  }, [isAdmin, toast])

  const remaining = useMemo(() => formatRemaining(active?.expiresAt, tick), [active?.expiresAt, tick])

  const handleRespond = async (approved: boolean) => {
    if (!active || submitting) return
    setSubmitting(true)
    try {
      const response = await respondSkillApproval(active.id, {
        approved,
        note: decisionNote.trim() ? decisionNote.trim() : undefined,
      })
      if (!response?.success) {
        throw new Error(response?.error || '审批提交失败')
      }
      setQueue((prev) => prev.filter((item) => item.id !== active.id))
      setDecisionNote('')
      toast({
        title: approved ? '已批准技能调用' : '已拒绝技能调用',
        description: active.skill?.slug || active.toolName,
      })
    } catch (error) {
      toast({
        title: '审批提交失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!isAdmin || !active) {
    return null
  }

  const skillLabel = active.skill?.displayName || active.skill?.slug || `#${active.skillId}`
  const versionLabel = active.version?.version || (active.versionId ? String(active.versionId) : 'default')

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            技能调用审批
            <Badge variant="outline">待处理 {queue.length}</Badge>
          </DialogTitle>
          <DialogDescription>
            高风险 Skill 需要管理员确认后才会继续执行。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-[84px_1fr] gap-2">
            <span className="text-muted-foreground">Skill</span>
            <span className="font-medium break-all">{skillLabel}</span>
            <span className="text-muted-foreground">Version</span>
            <span className="break-all">{versionLabel}</span>
            <span className="text-muted-foreground">Tool</span>
            <span className="font-mono text-xs break-all">{active.toolName}</span>
            <span className="text-muted-foreground">请求方</span>
            <span className="break-all">{active.requestedByActor}</span>
            <span className="text-muted-foreground">超时</span>
            <span>{remaining || '-'}</span>
          </div>

          {active.reason ? (
            <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
              {active.reason}
            </div>
          ) : null}

          <Textarea
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.target.value)}
            placeholder="审批备注（可选）"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleRespond(false)}
            disabled={submitting}
          >
            拒绝
          </Button>
          <Button
            onClick={() => handleRespond(true)}
            disabled={submitting}
          >
            批准
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SkillApprovalInbox
