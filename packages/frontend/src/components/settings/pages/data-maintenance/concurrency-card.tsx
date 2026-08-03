"use client"

import { useEffect, useState } from "react"
import { Thermometer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface ConcurrencyCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

/**
 * 并发生成控制卡：1 个 key（chatMaxConcurrentStreams，1-8），行内保存，
 * 语义适配自 SystemMonitoringPage。
 */
export function ConcurrencyCard({ settings, update, refresh, isLoading }: ConcurrencyCardProps) {
  const { toast } = useToast()
  const [concurrencyDraft, setConcurrencyDraft] = useState("1")

  useEffect(() => {
    if (typeof settings.chatMaxConcurrentStreams === "number") {
      setConcurrencyDraft(String(settings.chatMaxConcurrentStreams))
    }
  }, [settings.chatMaxConcurrentStreams])

  const handleUpdate = async (payload: Record<string, unknown>, message: string) => {
    await update(payload as Partial<SystemSettings>)
    await refresh()
    toast({ title: message })
  }

  return (
    <FeatureCard
      icon={Thermometer}
      title="并发生成控制"
      description="限制同时进行的流式生成任务数"
    >
      <div className="space-y-3">
        <SettingRow
          title="最大并发数"
          description="允许同时进行的流式请求数量（1-8）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="maxConcurrentStreams"
              type="text"
              className="w-full sm:w-32 text-right"
              value={concurrencyDraft}
              disabled={isLoading}
              onChange={(e) => setConcurrencyDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={async () => {
                const parsed = Number.parseInt(concurrencyDraft, 10)
                if (Number.isNaN(parsed) || parsed < 1 || parsed > 8) {
                  toast({
                    title: "输入无效",
                    description: "请输入 1-8 之间的整数",
                    variant: "destructive",
                  })
                  return
                }
                await handleUpdate({ chatMaxConcurrentStreams: parsed }, "并发上限已更新")
              }}
            >
              保存
            </Button>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
