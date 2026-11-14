"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SkillUninstallPreviewState } from "@/features/skills/uninstall-preview"
import type { SkillUninstallDependencySource } from "@/types"

/**
 * 卸载预览 Dialog：原 `SkillsGovernancePage` 内联的 jsx 原样搬迁（文案、配色、滚动高度、
 * 按钮禁用态都不变），只把 `skillActionKey === delete:<id>` 的推导收敛成 `deleting` 入参。
 */

const PackageBucket = (props: {
  title: string
  hint: string
  items: string[]
  emptyText: string
  className: string
}) => {
  const { title, hint, items, emptyText, className } = props
  return (
    <div className={`rounded-lg border p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <Badge key={item} variant="secondary" className="font-mono text-xs">
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

const ActiveSkillSourcesBucket = (props: {
  packageNames: string[]
  sources: SkillUninstallDependencySource[]
}) => {
  const { packageNames, sources } = props
  const sourceMap = new Map(sources.map((item) => [item.packageName, item.consumers]))
  const displayPackages = Array.from(
    new Set([...packageNames, ...sources.map((item) => item.packageName)]),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <div className="rounded-lg border border-success/35 bg-success/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">保留（激活 Skill 占用）</span>
        <Badge variant="outline">{displayPackages.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">这些包仍被其他已激活 Skill 引用，展开可查看具体来源。</p>
      {displayPackages.length === 0 ? (
        <p className="text-xs text-muted-foreground">无此类保留包。</p>
      ) : (
        <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
          {displayPackages.map((packageName) => {
            const consumers = sourceMap.get(packageName) || []
            return (
              <details key={packageName} className="rounded-md border border-success/25 bg-surface px-3 py-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="font-mono text-xs">{packageName}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {consumers.length} 条来源
                  </Badge>
                </summary>
                <div className="mt-2 space-y-2 border-t border-border pt-2">
                  {consumers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无来源明细（请刷新后重试）。</p>
                  ) : (
                    consumers.map((consumer) => (
                      <div key={`${consumer.skillId}:${consumer.versionId}:${consumer.requirement}`} className="rounded-md border border-border bg-surface-subtle p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[11px]">
                            {consumer.skillDisplayName}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            {consumer.skillSlug}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            v{consumer.version}
                          </Badge>
                        </div>
                        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{consumer.requirement}</p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SkillUninstallDialog({
  open,
  preview,
  deleting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  preview: SkillUninstallPreviewState | null
  /** 卸载请求进行中：取消与确认都禁用，确认按钮显示「卸载中...」。 */
  deleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden rounded-lg border-border p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>卸载 Skill 前预览回收计划</DialogTitle>
          <DialogDescription>
            {preview
              ? `Skill「${preview.skillDisplayName}」将根据当前激活依赖与手动保留清单执行回收。`
              : "加载中"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Skill 声明依赖</span>
              <Badge variant="outline">{preview?.removedRequirements.length || 0}</Badge>
            </div>
            {preview?.removedRequirements?.length ? (
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                {preview.removedRequirements.map((requirement) => (
                  <Badge key={requirement} variant="secondary" className="font-mono text-xs">
                    {requirement}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">该 Skill 未声明 Python 依赖。</p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <PackageBucket
              title="将自动删除"
              hint="这些包未被其他激活 Skill 和手动保留清单引用。"
              items={preview?.removablePackages || []}
              emptyText="无可删除包。"
              className="border-destructive/40 bg-destructive/5"
            />
            <ActiveSkillSourcesBucket
              packageNames={preview?.keptByActiveSkills || []}
              sources={preview?.keptByActiveSkillSources || []}
            />
            <PackageBucket
              title="保留（手动保留清单）"
              hint="这些包在 Python 运行环境中被标记为手动保留。"
              items={preview?.keptByManual || []}
              emptyText="无此类保留包。"
              className="border-warning/35 bg-warning/5"
            />
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            取消
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={!preview || deleting}>
            {deleting ? "卸载中..." : "确认卸载 Skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
