'use client'

import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardDescription, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SkillApprovalRequestItem } from '@/types'
import { formatDateTime } from './shared'

type SkillApprovalsSectionProps = {
  loading: boolean
  approvals: SkillApprovalRequestItem[]
  approvalActionId: number | null
  onRespondApproval: (requestId: number, approved: boolean) => void
}

export function SkillApprovalsSection({
  loading,
  approvals,
  approvalActionId,
  onRespondApproval,
}: SkillApprovalsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div>
          <CardTitle className="text-lg font-semibold tracking-tight">待审批调用</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            高风险 Skill 调用会在此出现，处理后调用继续或终止。
          </CardDescription>
        </div>
      </div>
      <div className="rounded-lg border border-border/70 bg-card/30 p-4 sm:p-5">
        {loading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : approvals.length === 0 ? (
          <div className="text-sm text-muted-foreground">当前没有待审批请求。</div>
        ) : (
          <div className="overflow-auto rounded-md border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>请求方</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">#{item.id}</TableCell>
                    <TableCell>{item.skill?.slug || item.skillId}</TableCell>
                    <TableCell className="font-mono text-xs">{item.toolName}</TableCell>
                    <TableCell className="text-xs">{item.requestedByActor}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(item.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approvalActionId === item.id}
                          onClick={() => onRespondApproval(item.id, false)}
                        >
                          拒绝
                        </Button>
                        <Button
                          size="sm"
                          disabled={approvalActionId === item.id}
                          onClick={() => onRespondApproval(item.id, true)}
                        >
                          批准
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
