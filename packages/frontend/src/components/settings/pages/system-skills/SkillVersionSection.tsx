'use client'

import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardDescription, CardTitle } from '@/components/ui/card'
import type { SkillCatalogItem } from '@/types'
import { formatDateTime, SKILL_STATUS_BADGE_VARIANT } from './shared'

type SkillVersionSectionProps = {
  loading: boolean
  catalog: SkillCatalogItem[]
  versionActionKey: string | null
  onApproveVersion: (skillId: number, versionId: number) => void
  onActivateVersion: (skillId: number, versionId: number) => void
}

export function SkillVersionSection({
  loading,
  catalog,
  versionActionKey,
  onApproveVersion,
  onActivateVersion,
}: SkillVersionSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <FileText className="h-5 w-5 text-primary" />
        <div>
          <CardTitle className="text-lg font-semibold tracking-tight">Skill 版本管理</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            审批通过后可激活版本。激活时会覆盖该 Skill 的默认版本。
          </CardDescription>
        </div>
      </div>
      <div className="space-y-5">
        {loading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : catalog.length === 0 ? (
          <div className="text-sm text-muted-foreground">当前没有可管理的 Skill。</div>
        ) : (
          catalog.map((skill) => (
            <div key={skill.id} className="space-y-3 rounded-lg border border-border/70 bg-card/30 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{skill.displayName}</h3>
                <Badge variant="outline">{skill.slug}</Badge>
                <Badge variant={SKILL_STATUS_BADGE_VARIANT[skill.status || ''] || 'outline'}>
                  {skill.status || 'unknown'}
                </Badge>
                {skill.defaultVersion ? (
                  <Badge variant="secondary">default: {skill.defaultVersion.version}</Badge>
                ) : null}
              </div>
              {skill.description ? (
                <p className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
              ) : null}

              <div className="space-y-2">
                {(skill.versions || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无版本</p>
                ) : (
                  (skill.versions || []).map((version) => {
                    const isDefault = skill.defaultVersion?.id === version.id
                    const approving = versionActionKey === `approve:${skill.id}:${version.id}`
                    const activating = versionActionKey === `activate:${skill.id}:${version.id}`
                    return (
                      <div
                        key={version.id}
                        className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{version.version}</span>
                            <Badge variant={SKILL_STATUS_BADGE_VARIANT[version.status || ''] || 'outline'}>
                              {version.status}
                            </Badge>
                            <Badge variant="outline">{version.riskLevel || 'low'}</Badge>
                            {isDefault ? <Badge variant="secondary">default</Badge> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            创建：{formatDateTime(version.createdAt)} | 激活：{formatDateTime(version.activatedAt)}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {version.status === 'pending_approval' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={approving}
                              onClick={() => onApproveVersion(skill.id, version.id)}
                            >
                              {approving ? '审批中...' : '批准版本'}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            disabled={activating}
                            onClick={() => onActivateVersion(skill.id, version.id)}
                          >
                            {activating ? '激活中...' : '激活并设默认'}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
