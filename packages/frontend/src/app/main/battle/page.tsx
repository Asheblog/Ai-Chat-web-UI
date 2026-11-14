export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowRight, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function BattlePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">模型大乱斗</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">同一提示词，比较不同模型的回答与稳定性。</p>
        </header>
        <section className="v2-panel p-5 sm:p-6" aria-labelledby="new-battle-title">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-3">
              <Layers className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h2 id="new-battle-title" className="text-lg font-semibold tracking-tight">新建多模型对战</h2>
              <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">选择参赛模型，设置问题与参考答案，查看 Pass@k、准确率和耗时。</p>
            </div>
            <Button asChild className="h-11 shrink-0 gap-2 sm:h-9">
              <Link href="/main/battle/multi-model">新建多模型对战<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          </div>
          <ol className="mt-6 grid gap-3 border-t border-border pt-5 text-sm sm:grid-cols-3" aria-label="对战流程">
            {['选择模型', '设置问题', '查看结果'].map((label, index) => (
              <li key={label} className="flex items-center gap-3"><span className="text-xs tabular-nums text-muted-foreground">0{index + 1}</span>{label}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
