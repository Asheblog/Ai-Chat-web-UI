'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Sparkles, Zap, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'

const promptExamples = [
  {
    title: "解释量子计算",
    prompt: "请用简单的语言解释什么是量子计算，以及它与经典计算的主要区别。"
  },
  {
    title: "编写Python代码",
    prompt: "帮我写一个Python函数，用于计算斐波那契数列的第n项。"
  },
  {
    title: "创意写作",
    prompt: "写一个关于人工智能和人类友谊的短篇故事，要求情节温馨且富有想象力。"
  },
  {
    title: "健康建议",
    prompt: "给出一份适合办公室工作人员的每日运动建议，包括具体的动作和时间安排。"
  }
]

export function WelcomeScreen() {
  const { createSession } = useChatStore()
  const { systemSettings } = useSettingsStore()
  const [isCreating, setIsCreating] = useState(false)

  const handleExampleClick = async (prompt: string) => {
    if (!systemSettings?.systemModels || systemSettings.systemModels.length === 0) {
      return
    }

    setIsCreating(true)
    try {
      await createSession(systemSettings.systemModels[0].id, prompt.slice(0, 50) + '...')
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleNewChat = async () => {
    if (!systemSettings?.systemModels || systemSettings.systemModels.length === 0) {
      return
    }

    setIsCreating(true)
    try {
      await createSession(systemSettings.systemModels[0].id)
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        {/* 头部欢迎信息 */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="p-3 bg-primary/10 rounded-full">
              <MessageSquare className="h-12 w-12 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">
            欢迎使用 AI 聊天平台
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            一个轻量级、易部署的AI聊天应用，支持自定义模型接入，让每个开发者都能拥有自己的专属AI助手。
          </p>
          <Button
            onClick={handleNewChat}
            disabled={isCreating || !systemSettings?.systemModels?.length}
            className="mt-6"
            size="lg"
          >
            {isCreating ? '创建中...' : '开始新对话'}
          </Button>
        </div>

        {/* 特性介绍 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <Card>
            <CardHeader className="text-center">
              <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
              <CardTitle className="text-lg">智能对话</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                支持多轮对话，理解上下文，提供流畅的聊天体验
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <Zap className="h-8 w-8 text-primary mx-auto mb-2" />
              <CardTitle className="text-lg">轻量高效</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                极致轻量设计，低内存占用，快速响应
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <Shield className="h-8 w-8 text-primary mx-auto mb-2" />
              <CardTitle className="text-lg">安全私有</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                本地部署，数据私有化，支持加密存储
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <MessageSquare className="h-8 w-8 text-primary mx-auto mb-2" />
              <CardTitle className="text-lg">自定义模型</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                支持接入多种第三方AI模型，灵活配置
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* 示例提示 */}
        <div>
          <h2 className="text-2xl font-semibold text-center mb-6">
            试试这些示例
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {promptExamples.map((example, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleExampleClick(example.prompt)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{example.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {example.prompt}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}