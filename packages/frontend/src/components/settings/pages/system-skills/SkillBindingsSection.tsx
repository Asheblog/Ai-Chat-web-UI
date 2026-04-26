'use client'

import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { SkillBindingItem, SkillCatalogItem, SkillVersionItem } from '@/types'
import { type ScopeType, resolveVersionLabel } from './shared'

type SkillBindingsSectionProps = {
  catalog: SkillCatalogItem[]
  bindings: SkillBindingItem[]
  versionOptions: SkillVersionItem[]
  bindingSkillId: number | null
  bindingVersionId: string
  bindingScopeType: ScopeType
  bindingScopeId: string
  bindingEnabled: boolean
  bindingPolicyDraft: string
  bindingOverridesDraft: string
  bindingSubmitting: boolean
  onBindingSkillIdChange: (value: number | null) => void
  onBindingVersionIdChange: (value: string) => void
  onBindingScopeTypeChange: (value: ScopeType) => void
  onBindingScopeIdChange: (value: string) => void
  onBindingEnabledChange: (value: boolean) => void
  onBindingPolicyDraftChange: (value: string) => void
  onBindingOverridesDraftChange: (value: string) => void
  onUpsertBinding: () => void
  onDeleteBinding: (bindingId: number) => void
}

export function SkillBindingsSection({
  catalog,
  bindings,
  versionOptions,
  bindingSkillId,
  bindingVersionId,
  bindingScopeType,
  bindingScopeId,
  bindingEnabled,
  bindingPolicyDraft,
  bindingOverridesDraft,
  bindingSubmitting,
  onBindingSkillIdChange,
  onBindingVersionIdChange,
  onBindingScopeTypeChange,
  onBindingScopeIdChange,
  onBindingEnabledChange,
  onBindingPolicyDraftChange,
  onBindingOverridesDraftChange,
  onUpsertBinding,
  onDeleteBinding,
}: SkillBindingsSectionProps) {
  return (
    <section className="v2-panel bg-white/90 p-4 shadow-none sm:p-5">
      <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
          <Link2 className="h-5 w-5" />
        </span>
        <div>
          <h2 className="v2-section-title">绑定策略</h2>
          <p className="v2-muted-line mt-1">
            创建/更新 Skill 绑定，并可查看现有绑定。
          </p>
        </div>
      </div>
      <div className="space-y-5">
        <div className="space-y-3 rounded-[10px] border border-border/70 bg-slate-50/70 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Skill</Label>
              <Select
                value={bindingSkillId != null ? String(bindingSkillId) : ''}
                onValueChange={(value) => onBindingSkillIdChange(Number.parseInt(value, 10))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择 Skill" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((skill) => (
                    <SelectItem key={skill.id} value={String(skill.id)}>
                      {skill.displayName} ({skill.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Version</Label>
              <Select value={bindingVersionId} onValueChange={onBindingVersionIdChange}>
                <SelectTrigger>
                  <SelectValue placeholder="default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  {versionOptions.map((version) => (
                    <SelectItem key={version.id} value={String(version.id)}>
                      {version.version} ({version.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Scope Type</Label>
              <Select
                value={bindingScopeType}
                onValueChange={(value) => onBindingScopeTypeChange(value as ScopeType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">system</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="session">session</SelectItem>
                  <SelectItem value="battle_model">battle_model</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Scope ID</Label>
              <Input
                value={bindingScopeId}
                onChange={(event) => onBindingScopeIdChange(event.target.value)}
                placeholder={bindingScopeType === 'system' ? 'global' : '请输入 scopeId'}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Policy JSON</Label>
              <Textarea
                rows={4}
                value={bindingPolicyDraft}
                onChange={(event) => onBindingPolicyDraftChange(event.target.value)}
                placeholder='例如：{"approval":"once_per_session"}'
              />
            </div>
            <div className="space-y-1">
              <Label>Overrides JSON</Label>
              <Textarea
                rows={4}
                value={bindingOverridesDraft}
                onChange={(event) => onBindingOverridesDraftChange(event.target.value)}
                placeholder='例如：{"web-search":{"scope":"webpage"}}'
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-border/60 pt-4">
            <div className="flex items-center gap-2 text-sm">
              <Switch checked={bindingEnabled} onCheckedChange={(value) => onBindingEnabledChange(Boolean(value))} />
              <span>启用绑定</span>
            </div>
            <Button onClick={onUpsertBinding} disabled={bindingSubmitting}>
              {bindingSubmitting ? '保存中...' : '保存绑定'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {bindings.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-border/70 bg-slate-50/70 p-5 text-sm text-muted-foreground">
              暂无绑定。
            </div>
          ) : (
            <div className="v2-table-wrap overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Skill</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>启用</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bindings.map((binding) => {
                    const boundSkill = catalog.find((item) => item.id === binding.skillId)
                    return (
                      <TableRow key={binding.id}>
                        <TableCell className="font-mono text-xs">#{binding.id}</TableCell>
                        <TableCell>{binding.skill?.slug || boundSkill?.slug || binding.skillId}</TableCell>
                        <TableCell>{resolveVersionLabel(boundSkill, binding.versionId)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {binding.scopeType}:{binding.scopeId}
                        </TableCell>
                        <TableCell>{binding.enabled ? '是' : '否'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDeleteBinding(binding.id)}
                          >
                            删除
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
