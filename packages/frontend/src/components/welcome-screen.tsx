'use client'

// 全新欢迎页：模仿 ChatGPT 着陆面板（大标题 + 大输入框），并保持响应式
import { useEffect, useMemo, useState } from 'react'
import { Plus, Mic } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/model-selector'
import { useChatStore } from '@/store/chat-store'
import { apiClient } from '@/lib/api'

export function WelcomeScreen() {
  const { createSession, streamMessage } = useChatStore()

  const [query, setQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)

  // 选择一个默认模型（取聚合列表的第一个）
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getAggregatedModels()
        const first = res?.data?.[0]?.id as string | undefined
        if (first) setSelectedModelId(first)
      } catch {}
    })()
  }, [])

  const canCreate = useMemo(() => !!selectedModelId, [selectedModelId])

  const handleCreate = async () => {
    if (!canCreate || !selectedModelId) return

    setIsCreating(true)
    const text = query.trim()
    try {
      // 以输入作为标题（截断）以便会话列表更清晰
      const title = text ? text.slice(0, 50) : '新的对话'
      await createSession(selectedModelId, title)

      // 如果输入不为空，创建会话后直接发送首条消息
      if (text) {
        const session = useChatStore.getState().currentSession
        if (session) {
          await streamMessage(session.id, text)
        }
      }
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
      setQuery('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">

      {/* 中心标题 */}
      <h1 className="text-center text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight mb-8">
        有什么可以帮忙的?
      </h1>

      {/* 大输入框区域 */}
      <div className="w-full max-w-3xl">
        <div className="flex items-center h-14 sm:h-16 rounded-full border bg-background shadow-sm px-3 sm:px-4 focus-within:ring-2 focus-within:ring-ring transition">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full text-muted-foreground"
            onClick={handleCreate}
            disabled={!canCreate || isCreating}
            aria-label="开始新对话"
          >
            <Plus className="h-5 w-5" />
          </Button>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="询问任何问题"
            disabled={!canCreate || isCreating}
            className="flex-1 h-10 sm:h-12 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 sm:px-4"
          />

          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full text-muted-foreground"
              disabled
              aria-label="语音输入（占位）"
            >
              <Mic className="h-5 w-5" />
            </Button>
            {/* 将模型选择器放到输入框右侧（ChatGPT 风格） */}
            <ModelSelector
              variant="inline"
              selectedModelId={selectedModelId}
              onModelChange={(id) => setSelectedModelId(id)}
              disabled={!canCreate || isCreating}
            />
          </div>
        </div>
      </div>

      {/* 页脚提示信息 */}
      <p className="mt-8 text-xs sm:text-[13px] text-muted-foreground text-center px-4">
        AIChat 可能生成不准确或不完整的内容，请自行核实关键信息。
      </p>
    </div>
  )
}
