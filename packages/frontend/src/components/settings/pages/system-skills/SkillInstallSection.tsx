'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SkillInstallSectionProps = {
  installSource: string
  installToken: string
  installing: boolean
  refreshing: boolean
  onInstallSourceChange: (value: string) => void
  onInstallTokenChange: (value: string) => void
  onInstall: () => void
  onRefresh: () => void
}

export function SkillInstallSection({
  installSource,
  installToken,
  installing,
  refreshing,
  onInstallSourceChange,
  onInstallTokenChange,
  onInstall,
  onRefresh,
}: SkillInstallSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <Download className="h-5 w-5 text-primary" />
        <div>
          <CardTitle className="text-lg font-semibold tracking-tight">Skill 安装</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            支持 GitHub `owner/repo@ref[:subdir]`，例如 `aichat/skills-repo@main:skills/web-search`。
          </CardDescription>
        </div>
      </div>
      <div className="space-y-4 rounded-lg border border-border/70 bg-card/30 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_280px_auto]">
          <div className="space-y-1">
            <Label>GitHub Source</Label>
            <Input
              value={installSource}
              onChange={(event) => onInstallSourceChange(event.target.value)}
              placeholder="owner/repo@ref[:subdir]"
            />
          </div>
          <div className="space-y-1">
            <Label>Token（可选）</Label>
            <Input
              type="password"
              value={installToken}
              onChange={(event) => onInstallTokenChange(event.target.value)}
              placeholder="仅私有仓库需要"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onInstall} disabled={installing} className="w-full md:w-auto">
              {installing ? '安装中...' : '安装'}
            </Button>
          </div>
        </div>
        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? '刷新中...' : '刷新数据'}
          </Button>
        </div>
      </div>
    </div>
  )
}
