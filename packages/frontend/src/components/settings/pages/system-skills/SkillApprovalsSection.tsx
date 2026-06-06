'use client'

import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <section className="v2-panel p-4 shadow-none sm:p-5">
      <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="v2-section-title">待审批调用</h2>
          <p className="v2-muted-line mt-1">
            高风险 Skill 调用会在此出现，处理后调用继续或终止。
          </p>
        </div>
      </div>
      <div>
        {loading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : approvals.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-border/70 bg-muted/40 p-5 text-sm text-muted-foreground">
            当前没有待审批请求。
          </div>
        ) : (
          <div className="v2-table-wrap overflow-x-auto">
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
    </section>
  )
}
