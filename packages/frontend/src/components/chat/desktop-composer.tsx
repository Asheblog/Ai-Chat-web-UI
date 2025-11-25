'use client'

import type { KeyboardEventHandler, MutableRefObject } from 'react'
import { motion } from 'framer-motion'
import { Plus, Maximize2, ImagePlus, Send, Square } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChatImagePreview } from './chat-image-preview'
import { sendButtonVariants } from '@/lib/animations'

interface DesktopComposerProps {
  input: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onCompositionStart: () => void
  onCompositionEnd: () => void
  placeholder: string
  textareaDisabled: boolean
  isStreaming: boolean
  selectedImages: ChatComposerImage[]
  onRemoveImage: (index: number) => void
  pickImages: () => void
  isVisionEnabled: boolean
  imageLimits: { maxCount: number; maxMb: number; maxEdge: number; maxTotalMb: number }
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  webSearchEnabled: boolean
  onToggleWebSearch: (value: boolean) => void
  webSearchScope: string
  onWebSearchScopeChange: (value: string) => void
  showWebSearchScope: boolean
  canUseWebSearch: boolean
  traceEnabled: boolean
  canUseTrace: boolean
  onToggleTrace: (value: boolean) => void
  effort: 'low' | 'medium' | 'high' | 'unset'
  onEffortChange: (value: 'low' | 'medium' | 'high' | 'unset') => void
  showExpand: boolean
  onExpandOpen: () => void
  onSend: () => void
  onStop: () => void
  desktopSendDisabled: boolean
  sendLockedReason: string | null
}

export function DesktopComposer({
  input,
  textareaRef,
  onInputChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  textareaDisabled,
  isStreaming,
  selectedImages,
  onRemoveImage,
  pickImages,
  isVisionEnabled,
  imageLimits,
  thinkingEnabled,
  onToggleThinking,
  webSearchEnabled,
  onToggleWebSearch,
  webSearchScope,
  onWebSearchScopeChange,
  showWebSearchScope,
  canUseWebSearch,
  traceEnabled,
  canUseTrace,
  onToggleTrace,
  effort,
  onEffortChange,
  showExpand,
  onExpandOpen,
  onSend,
  onStop,
  desktopSendDisabled,
  sendLockedReason,
}: DesktopComposerProps) {
  const sendTooltip = isStreaming ? '停止生成' : sendLockedReason ?? '发送'

  return (
    <div className="hidden md:block">
      <div className="mx-auto max-w-3xl px-4 md:px-6 pb-6">
        <ChatImagePreview images={selectedImages} onRemove={onRemoveImage} />
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
                  <Switch checked={thinkingEnabled} onCheckedChange={(checked) => onToggleThinking(Boolean(checked))} />
                </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">联网搜索</span>
                <Switch
                  checked={webSearchEnabled && canUseWebSearch}
                  onCheckedChange={(checked) => onToggleWebSearch(Boolean(checked))}
                  disabled={!canUseWebSearch}
                />
              </div>
              {showWebSearchScope ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">搜索范围（Metaso）</span>
                  <Select value={webSearchScope} onValueChange={(value) => onWebSearchScopeChange(value)} disabled={!canUseWebSearch}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="选择范围" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webpage">网页</SelectItem>
                      <SelectItem value="document">文档</SelectItem>
                      <SelectItem value="paper">论文</SelectItem>
                      <SelectItem value="image">图片</SelectItem>
                      <SelectItem value="video">视频</SelectItem>
                      <SelectItem value="podcast">播客</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {canUseTrace ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">任务追踪</span>
                    <Switch
                      checked={traceEnabled}
                      onCheckedChange={(checked) => onToggleTrace(Boolean(checked))}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">仅管理员可见，用于临时关闭某次追踪。</p>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">思考深度</span>
                <Select value={effort} onValueChange={(value) => onEffortChange(value as typeof effort)}>
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
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              placeholder={isStreaming ? 'AI正在思考中...' : placeholder}
              disabled={textareaDisabled}
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
                    onClick={onExpandOpen}
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
                  ? `添加图片（限制：最多 ${imageLimits.maxCount} 张，单张 ≤ ${imageLimits.maxMb}MB，总体积 ≤ ${imageLimits.maxTotalMb}MB，最大边长 ≤ ${imageLimits.maxEdge}px）`
                  : '当前模型不支持图片'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  onClick={isStreaming ? onStop : onSend}
                  disabled={desktopSendDisabled}
                  aria-label={isStreaming ? '停止生成' : '发送'}
                  className={`h-12 w-12 inline-flex items-center justify-center rounded-full ${
                    isStreaming ? 'bg-destructive text-destructive-foreground hover:opacity-90' : 'bg-primary text-primary-foreground hover:opacity-90'
                  }`}
                  variants={sendButtonVariants}
                  animate={isStreaming ? 'sending' : 'idle'}
                  whileHover={!isStreaming ? 'hover' : undefined}
                  whileTap={!isStreaming ? 'tap' : undefined}
                >
                  {isStreaming ? <Square className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>{sendTooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
