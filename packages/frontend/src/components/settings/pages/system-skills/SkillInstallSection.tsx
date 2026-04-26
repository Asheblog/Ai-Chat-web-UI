'use client'

import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <section className="v2-panel bg-white/90 p-4 shadow-none sm:p-5">
      <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
          <Download className="h-5 w-5" />
        </span>
        <div>
          <h2 className="v2-section-title">Skill 安装</h2>
          <p className="v2-muted-line mt-1">
            支持 GitHub `owner/repo@ref[:subdir]` 或 `github.com/.../(tree|blob)/...`，例如
            `anthropics/skills@main:skills/pptx`。
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_minmax(220px,280px)_auto]">
          <div className="space-y-1">
            <Label>GitHub Source</Label>
            <Input
              value={installSource}
              onChange={(event) => onInstallSourceChange(event.target.value)}
              placeholder="owner/repo@ref[:subdir] 或 github.com/.../SKILL.md"
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
            <Button type="button" onClick={onInstall} disabled={installing} className="w-full md:w-auto">
              {installing ? '安装中...' : '安装'}
            </Button>
          </div>
        </div>
        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button type="button" variant="outline" onClick={onRefresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {refreshing ? '刷新中...' : '刷新数据'}
          </Button>
        </div>
      </div>
    </section>
  )
}
