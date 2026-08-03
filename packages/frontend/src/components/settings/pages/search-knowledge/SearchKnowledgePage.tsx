"use client"

import { useEffect } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { WebSearchCard } from "./web-search-card"
import { RagCard } from "./rag-card"
import { KnowledgeBaseCard } from "./knowledge-base-card"

export function SearchKnowledgePage() {
  const {
    settings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  if (isLoading && !settings) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || "无法加载系统设置"}</p>
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <Search className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">搜索与知识库</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            配置联网搜索、文档解析与知识库
          </CardDescription>
        </div>
      </div>

      <WebSearchCard
        settings={settings}
        update={updateSystemSettings}
        refresh={fetchSystemSettings}
        isLoading={isLoading}
      />
      <RagCard
        settings={settings}
        update={updateSystemSettings}
        refresh={fetchSystemSettings}
        isLoading={isLoading}
      />
      <KnowledgeBaseCard
        settings={settings}
        update={updateSystemSettings}
        refresh={fetchSystemSettings}
        isLoading={isLoading}
      />
    </div>
  )
}
