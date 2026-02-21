'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'
import { FileText, ShieldCheck } from 'lucide-react'
import { listSkillAudits, listSkillCatalog } from '@/features/skills/api'
import type { SkillCatalogItem, SkillExecutionAuditItem } from '@/types'

const APPROVAL_OPTIONS = [
  { value: 'all', label: '全部审批状态' },
  { value: 'approved', label: 'approved' },
  { value: 'denied', label: 'denied' },
  { value: 'expired', label: 'expired' },
  { value: 'skipped', label: 'skipped' },
] as const

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  approved: 'default',
  skipped: 'secondary',
  denied: 'destructive',
  expired: 'outline',
}

const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleString()
}

const parseInputInt = (value: string) => {
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

const normalizePayload = (raw: string | null | undefined) => {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

export function SystemSkillAuditsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<SkillExecutionAuditItem[]>([])
  const [skills, setSkills] = useState<SkillCatalogItem[]>([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const [skillId, setSkillId] = useState<string>('all')
  const [toolName, setToolName] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [battleRunId, setBattleRunId] = useState('')
  const [approvalStatus, setApprovalStatus] = useState<(typeof APPROVAL_OPTIONS)[number]['value']>('all')
  const [hasErrorOnly, setHasErrorOnly] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize])

  const fetchSkills = useCallback(async () => {
    try {
      const response = await listSkillCatalog({ all: true })
      setSkills(Array.isArray(response?.data) ? response.data : [])
    } catch {
      // ignore catalog failure; logs can still load
    }
  }, [])

  const fetchAudits = useCallback(async (nextPage = page) => {
    setLoading(true)
    try {
      const response = await listSkillAudits({
        page: nextPage,
        pageSize,
        skillId: skillId === 'all' ? undefined : parseInputInt(skillId),
        toolName: toolName.trim() || undefined,
        sessionId: parseInputInt(sessionId),
        battleRunId: parseInputInt(battleRunId),
        approvalStatus: approvalStatus === 'all' ? undefined : approvalStatus,
        hasError: hasErrorOnly || undefined,
      })
      if (!response?.success || !response.data) {
        throw new Error(response?.error || '加载审计日志失败')
      }
      setItems(Array.isArray(response.data.items) ? response.data.items : [])
      setTotal(Number(response.data.total || 0))
      setHasMore(Boolean(response.data.hasMore))
      setPage(Number(response.data.page || nextPage))
    } catch (error) {
      toast({
        title: '加载 Skill 审计日志失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [approvalStatus, battleRunId, hasErrorOnly, page, pageSize, sessionId, skillId, toast, toolName])

  useEffect(() => {
    fetchSkills()
    fetchAudits(1)
  }, [fetchAudits, fetchSkills])

  const handleSearch = () => {
    setExpandedIds(new Set())
    void fetchAudits(1)
  }

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="space-y-4">
        <div className="flex items-center gap-3 border-b border-border/60 pb-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">Skill 审计日志</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              查询 SkillExecutionAudit，定位审批、执行错误与耗时问题。
            </CardDescription>
          </div>
        </div>
        <div className="space-y-4 rounded-lg border border-border/70 bg-card/30 p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1 lg:col-span-2">
              <Label>Skill</Label>
              <Select value={skillId} onValueChange={setSkillId}>
                <SelectTrigger>
                  <SelectValue placeholder="全部 Skill" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部 Skill</SelectItem>
                  {skills.map((skill) => (
                    <SelectItem key={skill.id} value={String(skill.id)}>
                      {skill.displayName} ({skill.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Tool</Label>
              <Input
                value={toolName}
                onChange={(event) => setToolName(event.target.value)}
                placeholder="tool 名称"
              />
            </div>

            <div className="space-y-1">
              <Label>Session ID</Label>
              <Input
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                placeholder="例如 123"
              />
            </div>

            <div className="space-y-1">
              <Label>Battle Run ID</Label>
              <Input
                value={battleRunId}
                onChange={(event) => setBattleRunId(event.target.value)}
                placeholder="例如 456"
              />
            </div>

            <div className="space-y-1">
              <Label>审批状态</Label>
              <Select value={approvalStatus} onValueChange={(value) => setApprovalStatus(value as typeof approvalStatus)}>
                <SelectTrigger>
                  <SelectValue placeholder="全部审批状态" />
                </SelectTrigger>
                <SelectContent>
                  {APPROVAL_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <Button variant={hasErrorOnly ? 'default' : 'outline'} onClick={() => setHasErrorOnly((prev) => !prev)}>
              {hasErrorOnly ? '仅错误：开' : '仅错误：关'}
            </Button>
            <Button onClick={handleSearch} disabled={loading}>
              查询
            </Button>
            <Button variant="outline" onClick={() => fetchAudits(page)} disabled={loading}>
              刷新
            </Button>
            <div className="ml-auto text-xs text-muted-foreground">
              共 {total} 条，页码 {page}/{totalPages}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3 border-b border-border/60 pb-3">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">审计结果</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              支持展开请求/响应载荷，快速定位执行异常和审批链路问题。
            </CardDescription>
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/30 p-4 sm:p-5">
          {loading && items.length === 0 ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">没有匹配的审计日志。</div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>Skill</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>审批</TableHead>
                      <TableHead>耗时</TableHead>
                      <TableHead>上下文</TableHead>
                      <TableHead>结果</TableHead>
                      <TableHead className="text-right">详情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const expanded = expandedIds.has(item.id)
                      const resultText = item.error ? 'error' : 'ok'
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="text-xs">{formatDateTime(item.createdAt)}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="text-sm">{item.skill?.slug || item.skillId}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.version?.version || item.versionId || '-'}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{item.toolName}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_BADGE_VARIANT[item.approvalStatus || ''] || 'outline'}>
                              {item.approvalStatus || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {typeof item.durationMs === 'number' ? `${item.durationMs}ms` : '-'}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>session: {item.sessionId ?? '-'}</div>
                            <div>battle: {item.battleRunId ?? '-'}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={item.error ? 'destructive' : 'secondary'}>{resultText}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" onClick={() => toggleExpand(item.id)}>
                              {expanded ? '收起' : '展开'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {items.map((item) => {
                if (!expandedIds.has(item.id)) return null
                return (
                  <div key={`detail-${item.id}`} className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs space-y-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="mb-1 font-medium">Request Payload</div>
                        <pre className="max-h-64 overflow-auto rounded border border-border/70 bg-background p-2">
                          {normalizePayload(item.requestPayloadJson)}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 font-medium">Response Payload</div>
                        <pre className="max-h-64 overflow-auto rounded border border-border/70 bg-background p-2">
                          {normalizePayload(item.responsePayloadJson)}
                        </pre>
                      </div>
                    </div>
                    {item.error ? (
                      <div>
                        <div className="mb-1 font-medium text-destructive">Error</div>
                        <pre className="max-h-40 overflow-auto rounded border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                          {item.error}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => fetchAudits(Math.max(1, page - 1))}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasMore || loading}
                  onClick={() => fetchAudits(page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SystemSkillAuditsPage
