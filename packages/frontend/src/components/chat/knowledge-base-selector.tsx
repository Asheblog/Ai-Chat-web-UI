/**
 * 知识库选择对话框
 * 用于在聊天界面选择要启用的知识库
 */

'use client'

import { BookOpen, Check, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { KnowledgeBaseItem } from '@/hooks/use-knowledge-base'

// Re-export the type for use in other components
export type { KnowledgeBaseItem } from '@/hooks/use-knowledge-base'

interface KnowledgeBaseSelectorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    availableKbs: KnowledgeBaseItem[]
    selectedKbIds: number[]
    isLoading: boolean
    error: string | null
    onToggle: (id: number) => void
    onSelectAll: () => void
    onClearAll: () => void
    onRefresh: () => Promise<void>
}

export function KnowledgeBaseSelector({
    open,
    onOpenChange,
    availableKbs,
    selectedKbIds,
    isLoading,
    error,
    onToggle,
    onSelectAll,
    onClearAll,
    onRefresh,
}: KnowledgeBaseSelectorProps) {
    const selectedCount = selectedKbIds.length
    const allSelected = availableKbs.length > 0 && selectedCount === availableKbs.length

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5" />
                        选择知识库
                    </DialogTitle>
                    <DialogDescription>
                        选择要在本次对话中使用的知识库，AI 将从选中的知识库中检索相关内容来回答问题
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-4">
                    {/* 操作栏 */}
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                            已选择 {selectedCount} 个知识库
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={allSelected ? onClearAll : onSelectAll}
                                disabled={isLoading || availableKbs.length === 0}
                            >
                                {allSelected ? '取消全选' : '全选'}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onRefresh}
                                disabled={isLoading}
                            >
                                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                            </Button>
                        </div>
                    </div>

                    {/* 知识库列表 */}
                    <div className="max-h-[300px] overflow-y-auto space-y-2">
                        {isLoading && availableKbs.length === 0 ? (
                            <>
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </>
                        ) : error ? (
                            <div className="text-center py-6 text-destructive">
                                <p>{error}</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={onRefresh}
                                    className="mt-2"
                                >
                                    重试
                                </Button>
                            </div>
                        ) : availableKbs.length === 0 ? (
                            <div className="text-center py-6 text-muted-foreground">
                                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p>暂无可用知识库</p>
                                <p className="text-sm">请联系管理员创建知识库</p>
                            </div>
                        ) : (
                            availableKbs.map((kb) => {
                                const isSelected = selectedKbIds.includes(kb.id)
                                return (
                                    <div
                                        key={kb.id}
                                        className={cn(
                                            'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                                            isSelected
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border hover:border-primary/50'
                                        )}
                                        onClick={() => onToggle(kb.id)}
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() => onToggle(kb.id)}
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{kb.name}</div>
                                            {kb.description && (
                                                <div className="text-sm text-muted-foreground truncate">
                                                    {kb.description}
                                                </div>
                                            )}
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {kb.documentCount} 个文档 · {kb.totalChunks} 个分块
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <Check className="h-4 w-4 text-primary shrink-0" />
                                        )}
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button onClick={() => onOpenChange(false)}>
                        确定 {selectedCount > 0 && `(${selectedCount})`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/**
 * 知识库状态指示器
 * 在聊天输入框附近显示当前选中的知识库状态
 */
interface KnowledgeBaseIndicatorProps {
    selectedKbs: KnowledgeBaseItem[]
    onOpen: () => void
    onRemove: (id: number) => void
}

export function KnowledgeBaseIndicator({
    selectedKbs,
    onOpen,
    onRemove,
}: KnowledgeBaseIndicatorProps) {
    if (selectedKbs.length === 0) return null

    return (
        <div className="flex items-center gap-1 flex-wrap">
            {selectedKbs.slice(0, 3).map((kb) => (
                <div
                    key={kb.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
                >
                    <BookOpen className="h-3 w-3" />
                    <span className="truncate max-w-[100px]">{kb.name}</span>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove(kb.id)
                        }}
                        className="hover:bg-primary/20 rounded-full p-0.5"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            ))}
            {selectedKbs.length > 3 && (
                <button
                    type="button"
                    onClick={onOpen}
                    className="text-xs text-primary hover:underline"
                >
                    +{selectedKbs.length - 3} 更多
                </button>
            )}
        </div>
    )
}
