'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Send, Square, ImagePlus, X, Plus, Maximize2, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { ModelSelector } from '@/components/model-selector'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useChatComposer } from '@/hooks/use-chat-composer'
import { UserMenu } from '@/components/user-menu'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'

const MAX_AUTO_HEIGHT = 200

export function ChatInterface() {
  const {
    input,
    setInput,
    isComposing,
    setIsComposing,
    textareaRef,
    scrollAreaRef,
    fileInputRef,
    selectedImages,
    thinkingEnabled,
    setThinkingEnabled,
    effort,
    setEffort,
    noSaveThisRound,
    setNoSaveThisRound,
    messageMetas,
    messageBodies,
    messageRenderCache,
    isLoading,
    isStreaming,
    currentSession,
    error,
    isVisionEnabled,
    MAX_IMAGE_COUNT,
    MAX_IMAGE_MB,
    MAX_IMAGE_EDGE,
    handleSend,
    handleStop,
    handleKeyDown,
    handleTextareaChange,
    pickImages,
    onFilesSelected,
    removeImage,
  } = useChatComposer()

  const [showExpand, setShowExpand] = useState(false)
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')

  const resizeRaf = useRef<number | null>(null)
  const lastHeightRef = useRef<number>(0)

  const applyTextareaAutoHeight = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    if (resizeRaf.current) {
      cancelAnimationFrame(resizeRaf.current)
    }
    resizeRaf.current = requestAnimationFrame(() => {
      el.style.height = 'auto'
      const nextHeight = Math.min(el.scrollHeight, MAX_AUTO_HEIGHT)
      if (lastHeightRef.current !== nextHeight) {
        el.style.height = `${nextHeight}px`
        lastHeightRef.current = nextHeight
      }
      setShowExpand(el.scrollHeight > MAX_AUTO_HEIGHT)
    })
  }

  const handleTextareaInput = (value: string) => {
    handleTextareaChange(value)
    applyTextareaAutoHeight(textareaRef.current)
  }

  useEffect(() => {
    return () => {
      if (resizeRaf.current) {
        cancelAnimationFrame(resizeRaf.current)
      }
    }
  }, [])

  const desktopSendDisabled = (!input.trim() && selectedImages.length === 0) && !isStreaming

  const { actorState, quota } = useAuthStore((state) => ({ actorState: state.actorState, quota: state.quota }))
  const isAnonymous = actorState !== 'authenticated'
  const quotaRemaining = quota?.unlimited
    ? Infinity
    : quota?.remaining ?? (quota ? Math.max(0, quota.dailyLimit - quota.usedCount) : null)
  const quotaExhausted = Boolean(isAnonymous && quota && quotaRemaining !== null && quotaRemaining <= 0)
  const quotaLabel = quota?.unlimited ? '无限' : Math.max(0, quotaRemaining ?? 0)
  const basePlaceholder = quota
    ? (quotaExhausted ? '额度已用尽，请登录或等待次日重置' : `本日消息发送额度剩余 ${quotaLabel}`)
    : '输入消息（Shift+Enter 换行）'

  const imagePreview = selectedImages.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-2">
      {selectedImages.map((img, idx) => (
        <div key={idx} className="relative border rounded p-1">
          <Image
            src={img.dataUrl}
            alt={`预览图片 ${idx + 1}`}
            width={80}
            height={80}
            unoptimized
            className="h-20 w-20 object-contain rounded"
          />
          <button
            type="button"
            className="absolute -top-2 -right-2 bg-background border rounded-full p-1"
            onClick={() => removeImage(idx)}
            aria-label="移除图片"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )

  if (!currentSession) {
    return null
  }

  const toggleReasoning = (value: boolean) => {
    setThinkingEnabled(value)
    useChatStore.getState().updateSessionPrefs(currentSession.id, { reasoningEnabled: value })
  }

  const updateEffort = (value: 'low' | 'medium' | 'high' | 'unset') => {
    setEffort(value)
    useChatStore.getState().updateSessionPrefs(currentSession.id, {
      reasoningEffort: value === 'unset' ? undefined : value,
    })
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* 桌面端顶部工具栏 */}
      <div className="hidden lg:flex bg-background/80 supports-[backdrop-filter]:backdrop-blur px-4 h-14 items-center">
        <div className="flex w-full items-center justify-between gap-4">
          <ModelSelector
            selectedModelId={currentSession.modelLabel || currentSession.modelRawId || null}
            onModelChange={(model) => {
              const cur = useChatStore.getState().currentSession
              if (cur) {
                useChatStore.getState().switchSessionModel(cur.id, model)
              }
            }}
          />
          <UserMenu />
        </div>
      </div>

      {/* 消息列表 */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 md:px-6">
        <div className="pt-4 md:pt-6 pb-4 md:pb-6">
          {error && (
            <div className="mb-3 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {String(error)}
            </div>
          )}
          <MessageList
            metas={messageMetas}
            bodies={messageBodies}
            renderCache={messageRenderCache}
            isStreaming={isStreaming}
            isLoading={isLoading}
            scrollRootRef={scrollAreaRef}
          />
        </div>
      </ScrollArea>

      <div className="sticky bottom-0 w-full">
        {/* 移动端输入区 */}
        <div className="md:hidden px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+18px)]">
          <div className="rounded-3xl border bg-card shadow-sm px-3 py-3 space-y-3">
            {imagePreview}
            <div className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <div className="flex-1 overflow-hidden">
                  <Textarea
                    ref={textareaRef}
                    placeholder={currentSession ? '继续输入...' : '输入你要翻译的文字'}
                    value={input}
                    onChange={(e) => handleTextareaInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                  className="h-auto min-h-[40px] w-full resize-none rounded-2xl border-0 bg-muted/40 px-4 py-2 text-sm leading-[1.45] focus-visible:ring-0 focus-visible:ring-offset-0"
                    rows={1}
                    disabled={isStreaming}
                  />
                </div>

                <Button
                  type="button"
                  className={`h-12 w-12 shrink-0 rounded-full ${
                    isStreaming ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
                  }`}
                  onClick={() => {
                    if (isStreaming) {
                      handleStop()
                    } else {
                      handleSend()
                    }
                  }}
                  disabled={isStreaming ? false : (!input.trim() && selectedImages.length === 0)}
                  aria-label={isStreaming ? '停止' : '发送'}
                >
                  {isStreaming ? <Square className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={`h-10 rounded-full px-2 pr-3 flex items-center gap-2 transition-colors ${
                    thinkingEnabled
                      ? 'bg-primary/10 border-primary text-primary hover:bg-primary/20'
                      : 'bg-background border-border text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => toggleReasoning(!thinkingEnabled)}
                  aria-pressed={thinkingEnabled}
                  aria-label={thinkingEnabled ? '关闭思考模式' : '开启思考模式'}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ${
                      thinkingEnabled ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Brain className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-medium">{thinkingEnabled ? '深度思考中' : '深度思考'}</span>
                </Button>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 rounded-full"
                        onClick={pickImages}
                        disabled={isStreaming || !isVisionEnabled}
                        aria-label="上传图片"
                      >
                        <ImagePlus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>上传图片</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

          </div>
        </div>

        {/* 桌面端输入 Dock */}
        <div className="hidden md:block">
          <div className="mx-auto max-w-3xl px-4 md:px-6 pb-6">
            {imagePreview}
            <div className="flex items-end gap-3 transition">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-12 w-12 inline-flex items-center justify-center rounded-full text-muted-foreground border border-transparent hover:border-border/70 hover:bg-muted/40"
                    aria-label="更多操作"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 rounded-2xl">
                  <div className="px-3 py-3 space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">思考模式</span>
                      <Switch checked={thinkingEnabled} onCheckedChange={(checked) => toggleReasoning(!!checked)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">思考深度</span>
                      <Select value={effort} onValueChange={(value) => updateEffort(value as any)}>
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue placeholder="不设置" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unset">不设置</SelectItem>
                          <SelectItem value="low">low</SelectItem>
                          <SelectItem value="medium">medium</SelectItem>
                          <SelectItem value="high">high</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex-1">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => handleTextareaInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  placeholder={isStreaming ? 'AI正在思考中...' : basePlaceholder}
                  disabled={isStreaming || (quota ? quotaExhausted : false)}
                  className="h-auto min-h-[48px] w-full resize-none rounded-3xl border border-border/60 bg-muted/60 px-4 sm:px-5 py-3 leading-[1.4] text-left placeholder:text-muted-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  rows={1}
                />
              </div>

              {showExpand && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="h-12 w-12 inline-flex items-center justify-center rounded-full border border-transparent hover:border-border/70 hover:bg-muted/40"
                        onClick={() => {
                          setExpandDraft(input)
                          setExpandOpen(true)
                        }}
                        aria-label="全屏编辑"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>全屏编辑</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="h-12 w-12 inline-flex items-center justify-center rounded-full border hover:bg-muted"
                      onClick={pickImages}
                      disabled={isStreaming || !isVisionEnabled}
                      aria-label="添加图片"
                    >
                      <ImagePlus className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isVisionEnabled
                      ? `添加图片（限制：最多 ${MAX_IMAGE_COUNT} 张，单张 ≤ ${MAX_IMAGE_MB}MB，最大边长 ≤ ${MAX_IMAGE_EDGE}px）`
                      : '当前模型不支持图片'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={isStreaming ? handleStop : handleSend}
                      disabled={desktopSendDisabled}
                      aria-label={isStreaming ? '停止生成' : '发送'}
                      className={`h-12 w-12 inline-flex items-center justify-center rounded-full ${
                        isStreaming
                          ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                          : 'bg-primary text-primary-foreground hover:opacity-90'
                      }`}
                    >
                      {isStreaming ? <Square className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{isStreaming ? '停止生成' : '发送'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFilesSelected}
          disabled={!isVisionEnabled}
        />
      </div>

      <Dialog open={expandOpen} onOpenChange={setExpandOpen}>
        <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col">
          <div className="p-4 border-b rounded-t-2xl text-sm text-muted-foreground">编辑消息</div>
          <div className="flex-1 min-h-0 p-4">
            <Textarea
              value={expandDraft}
              onChange={(e) => setExpandDraft(e.target.value)}
              className="h-full w-full resize-none border rounded-md p-3"
            />
          </div>
          <div className="p-4 border-t rounded-b-2xl flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExpandOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setInput(expandDraft)
                setExpandOpen(false)
                const el = textareaRef.current
                if (el) {
                  el.value = expandDraft
                  applyTextareaAutoHeight(el)
                }
              }}
            >
              应用
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
