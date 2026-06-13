'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastHandler } from '@/features/chat/composer'

/**
 * 拖拽上传状态管理 Hook。
 * - 全局防止浏览器默认打开拖入的文件
 * - 提供 composer 区域的 drag handlers
 * - 按文件类型分流：图片→vision/工作区、文件夹→拒绝、其他→工作区
 */
export function useDragDrop(options: {
  isVisionEnabled: boolean
  onAddImageFiles?: (files: File[]) => void
  onUploadWorkspaceFiles?: (files: File[]) => void
  toast: ToastHandler
}) {
  const { isVisionEnabled, onAddImageFiles, onUploadWorkspaceFiles, toast } = options
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  // 全局防止浏览器默认打开拖入的文件（单次注册，组件卸载时清理）
  useEffect(() => {
    const preventGlobal = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
      }
    }
    document.addEventListener('dragover', preventGlobal)
    document.addEventListener('drop', preventGlobal)
    return () => {
      document.removeEventListener('dragover', preventGlobal)
      document.removeEventListener('drop', preventGlobal)
    }
  }, [])

  const classifyFiles = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList)
      const directories: File[] = []
      const images: File[] = []
      const others: File[] = []

      for (const file of files) {
        if (file.size === 0 && file.type === '') {
          directories.push(file)
        } else if (file.type.startsWith('image/')) {
          images.push(file)
        } else {
          others.push(file)
        }
      }

      if (directories.length > 0) {
        toast({
          title: '不支持文件夹',
          description: '请单独选择文件上传',
          variant: 'destructive',
        })
      }

      if (images.length > 0) {
        if (isVisionEnabled && onAddImageFiles) {
          onAddImageFiles(images)
        } else {
          others.push(...images)
          toast({
            title: '图片作为工作区文件',
            description: '当前模型不支持图片输入，已作为工作区文件上传',
          })
        }
      }

      if (others.length > 0 && onUploadWorkspaceFiles) {
        onUploadWorkspaceFiles(others)
      }
    },
    [isVisionEnabled, onAddImageFiles, onUploadWorkspaceFiles, toast],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragOver(false)

      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return

      classifyFiles(e.dataTransfer.files)
    },
    [classifyFiles],
  )

  return {
    isDragOver,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  }
}
