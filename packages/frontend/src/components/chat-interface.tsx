'use client'

import { useState } from 'react'
import {
  Send,
  Square,
  ImagePlus,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Maximize2,
  Settings as SettingsIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageList } from '@/components/message-list'
import { ModelSelector } from '@/components/model-selector'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useSettingsStore } from '@/store/settings-store'
import { useChatStore } from '@/store/chat-store'
import { useChatComposer } from '@/hooks/use-chat-composer'

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
    messages,
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

  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()

  const [showExpand, setShowExpand] = useState(false)
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandDraft, setExpandDraft] = useState('')

  if (!currentSession) {
    return null
  }

  const applyTextareaAutoHeight = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    const height = Math.min(el.scrollHeight, MAX_AUTO_HEIGHT)
    el.style.height = `${height}px`
    setShowExpand(el.scrollHeight > MAX_AUTO_HEIGHT)
  }

  const handleTextareaInput = (value: string) => {
    handleTextareaChange(value)
    applyTextareaAutoHeight(textareaRef.current)
  }

  const desktopSendDisabled = (!input.trim() && selectedImages.length === 0) && !isStreaming

  const imagePreview = selectedImages.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-2">
      {selectedImages.map((img, idx) => (
        <div key={idx} className="relative border rounded p-1">
          <img src={img.dataUrl} className="h-20 w-20 object-contain rounded" alt="" />
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

  const toggleReasoning = (value: boolean) => {
    setThinkingEnabled(value)
    if (currentSession) {
      useChatStore.getState().updateSessionPrefs(currentSession.id, { reasoningEnabled: value })
    }
  }

  const updateEffort = (value: 'low' | 'medium' | 'high' | 'unset') => {
    setEffort(value)
    if (currentSession) {
      useChatStore
        .getState()
        .updateSessionPrefs(currentSession.id, {
          reasoningEffort: value === 'unset' ? undefined : value,
        })
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* 桌面端顶部工具栏 */}
      <div className="hidden md:block border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="h-9 w-9 flex items-center justify-center rounded-md border hover:bg-muted"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                    aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                  >
                    {sidebarCollapsed ? (
                      <PanelLeftOpen className="h-4 w-4" />
                    ) : (
                      <PanelLeftClose className="h-4 w-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ModelSelector
              selectedModelId={currentSession.modelLabel || currentSession.modelRawId || null}
              onModelChange={(model) => {
                const cur = useChatStore.getState().currentSession
                if (cur) {
                  useChatStore.getState().switchSessionModel(cur.id, model)
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* 消息列表 */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 md:px-6">
        <div className="py-4 md:py-6">
          {error && (
            <div className="mb-3 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {String(error)}
            </div>
          )}
          <MessageList messages={messages} isStreaming={isStreaming} isLoading={isLoading} />
        </div>
      </ScrollArea>

      <div className="sticky bottom-0 w-full border-t bg-background">
        {/* 移动端输入区 */}
        <div className="px-4 pb-5 pt-3 md:hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground gap-2">
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full" aria-label="更多设置" disabled>
                <Plus className="h-4 w-4" />
              </Button>
              <span>思考模式</span>
              <Switch checked={thinkingEnabled} onCheckedChange={(checked) => toggleReasoning(!!checked)} />
            </div>
            <Select value={effort} onValueChange={(value) => updateEffort(value as any)}>
              <SelectTrigger className="h-8 w-[120px] rounded-full">
                <SelectValue placeholder="深度：未设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">深度：未设置</SelectItem>
                <SelectItem value="low">深度：较低</SelectItem>
                <SelectItem value="medium">深度：适中</SelectItem>
                <SelectItem value="high">深度：较高</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-3 rounded-2xl border bg-card shadow-sm px-3 py-2">
            <Textarea
              ref={textareaRef}
              placeholder={currentSession ? '继续输入...' : '输入你要翻译的文字'}
              value={input}
              onChange={(e) => handleTextareaInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              className="resize-none rounded-xl min-h-[110px]"
              rows={3}
            />

            {imagePreview}

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={noSaveThisRound ? 'secondary' : 'outline'}
                        size="icon"
                        className="h-10 w-10 rounded-full"
                        onClick={() => setNoSaveThisRound((prev) => !prev)}
                        aria-label="本轮不保存思考过程"
                      >
                        <SettingsIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{noSaveThisRound ? '已设置本轮不保存推理过程' : '点击后本轮不保存推理过程'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Button
                type="button"
                className="h-11 px-6 rounded-full"
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
                {isStreaming ? (
                  <>
                    <Square className="mr-1 h-4 w-4" /> 停止
                  </>
                ) : (
                  <>
                    <Send className="mr-1 h-4 w-4" /> 发送
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* 桌面端输入 Dock */}
        <div className="hidden md:block">
          <div className="mx-auto max-w-3xl px-4 md:px-6 pb-6">
            {imagePreview}
            <div className="rounded-full border bg-background shadow-sm px-4 py-2 gap-2 flex items-center min-h-16 focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-10 w-10 inline-flex items-center justify-center rounded-full text-muted-foreground"
                    aria-label="更多操作"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
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
                  placeholder={isStreaming ? 'AI正在思考中...' : '输入消息（Shift+Enter 换行）'}
                  disabled={isStreaming}
                  className="h-auto min-h-[48px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-0 leading-7 text-left placeholder:text-muted-foreground"
                  rows={1}
                />
              </div>

              {showExpand && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="h-10 w-10 inline-flex items-center justify-center rounded-full border hover:bg-muted"
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
                      className="h-10 w-10 inline-flex items-center justify-center rounded-full border hover:bg-muted"
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
                      className={`h-10 px-4 inline-flex items-center justify-center rounded-full ${
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
            <div className="mt-3 text-center text-[11px] text-muted-foreground">
              图片 ≤ 4 张 / 单张 5MB · 内容可能不准确，请核实关键信息。
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
        <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 sm:rounded-2xl overflow-hidden flex flex-col">
          <div className="p-4 border-b text-sm text-muted-foreground">编辑消息</div>
          <div className="flex-1 min-h-0 p-4">
            <Textarea
              value={expandDraft}
              onChange={(e) => setExpandDraft(e.target.value)}
              className="h-full w-full resize-none border rounded-md p-3"
            />
          </div>
          <div className="p-4 border-t flex justify-end gap-2">
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
