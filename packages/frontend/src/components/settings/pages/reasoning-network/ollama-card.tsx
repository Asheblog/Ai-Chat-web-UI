"use client"

import { Bot } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"

export interface OllamaCardProps {
  ollamaThink: boolean
  onOllamaThinkChange: (v: boolean) => void
}

/**
 * Ollama 专属卡：单行「Ollama think」位于「更多参数」折叠区（源 SystemReasoning 末行）。
 */
export function OllamaCard({ ollamaThink, onOllamaThinkChange }: OllamaCardProps) {
  return (
    <FeatureCard
      icon={Bot}
      title="Ollama 专属"
      description="针对 Ollama 上游的专属设置"
      cardKey="reasoning-network:ollama"
      moreLabel="更多参数"
      more={
        <SettingRow
          title="Ollama think"
          description="上游为 Ollama 时按需启用"
        >
          <Switch id="ollamaThink" checked={ollamaThink} onCheckedChange={(v) => onOllamaThinkChange(!!v)} />
        </SettingRow>
      }
    />
  )
}
