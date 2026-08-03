'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SkillInstallSectionProps = {
  installSource: string
  installToken: string
  installing: boolean
  onInstallSourceChange: (value: string) => void
  onInstallTokenChange: (value: string) => void
  onInstall: () => void
}

/**
 * Skill 安装表单（单消费者收口：仅 tools-extensions 的 SkillInstallCard 使用）。
 * 无内部标题/刷新按钮——标题与描述由外层 FeatureCard 承担。
 */
export function SkillInstallSection({
  installSource,
  installToken,
  installing,
  onInstallSourceChange,
  onInstallTokenChange,
  onInstall,
}: SkillInstallSectionProps) {
  return (
    <section className="v2-panel p-4 shadow-none sm:p-5">
      <p className="v2-muted-line mb-4">
        支持 GitHub `owner/repo@ref[:subdir]` 或 `github.com/.../(tree|blob)/...`，例如
        `anthropics/skills@main:skills/pptx`。
      </p>
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
      </div>
    </section>
  )
}
