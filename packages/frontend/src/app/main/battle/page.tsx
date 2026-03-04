export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Trophy, ListChecks, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function BattlePage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[hsl(var(--background-alt))/0.32]">
      <div className="mx-auto w-full max-w-[1100px] space-y-6 px-4 py-6 md:px-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">模型大乱斗</h1>
          <p className="text-sm text-muted-foreground">选择评测模式</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/70 bg-[hsl(var(--surface))/0.7]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="h-5 w-5 text-yellow-500" />
                多模型大乱斗
              </CardTitle>
              <CardDescription>同一题目下比较多个模型，评估 pass@k 与准确率</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="gap-2">
                <Link href="/main/battle/multi-model">
                  进入
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-[hsl(var(--surface))/0.7]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListChecks className="h-5 w-5 text-primary" />
                单模型多问题大乱斗
              </CardTitle>
              <CardDescription>批量题目稳定性评测，支持每题独立 pass 配置（最多 3）</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="gap-2">
                <Link href="/main/battle/single-model">
                  进入
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
