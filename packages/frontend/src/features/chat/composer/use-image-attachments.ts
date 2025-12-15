import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent } from 'react'
import type { ComposerImage, ImageLimits, ToastHandler } from './types'

interface UseImageAttachmentsOptions {
  isVisionEnabled: boolean
  limits: ImageLimits
  toast: ToastHandler
  visionDisabledMessage?: string
}

export const DEFAULT_VISION_DISABLED_MESSAGE = '当前模型不支持图片输入'

export const useImageAttachments = ({
  isVisionEnabled,
  limits,
  toast,
  visionDisabledMessage = DEFAULT_VISION_DISABLED_MESSAGE,
}: UseImageAttachmentsOptions) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedImages, setSelectedImages] = useState<ComposerImage[]>([])

  useEffect(() => {
    if (isVisionEnabled || selectedImages.length === 0) {
      return
    }
    setSelectedImages([])
    toast({
      title: '已清空图片',
      description: visionDisabledMessage,
      variant: 'destructive',
    })
  }, [isVisionEnabled, selectedImages.length, toast, visionDisabledMessage])

  const validateImage = useCallback(
    (file: File): Promise<{ ok: boolean; reason?: string; dataUrl?: string; mime?: string; size?: number }> => {
      return new Promise((resolve) => {
        if (!file.type.startsWith('image/')) {
          resolve({ ok: false, reason: '不支持的文件类型' })
          return
        }
        const sizeMB = file.size / (1024 * 1024)
        if (sizeMB > limits.maxMb) {
          resolve({ ok: false, reason: `图片大小超过限制（>${limits.maxMb}MB）` })
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const img = new Image()
          img.onload = () => {
            const w = img.naturalWidth
            const h = img.naturalHeight
            if (w > limits.maxEdge || h > limits.maxEdge) {
              resolve({ ok: false, reason: `分辨率过大（>${limits.maxEdge}像素）` })
            } else {
              resolve({ ok: true, dataUrl, mime: file.type, size: file.size })
            }
          }
          img.onerror = () => resolve({ ok: false, reason: '图片读取失败' })
          img.src = dataUrl
        }
        reader.onerror = () => resolve({ ok: false, reason: '文件读取失败' })
        reader.readAsDataURL(file)
      })
    },
    [limits.maxEdge, limits.maxMb],
  )

  const pickImages = useCallback(() => {
    if (!isVisionEnabled) {
      toast({
        title: '当前模型不支持图片',
        description: visionDisabledMessage,
        variant: 'destructive',
      })
      return
    }
    fileInputRef.current?.click()
  }, [isVisionEnabled, toast, visionDisabledMessage])

  const onFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      if (files.length === 0) return
      const existingBytes = selectedImages.reduce((sum, img) => sum + img.size, 0)
      const incomingBytes = files.reduce((sum, file) => sum + file.size, 0)
      const totalMb = (existingBytes + incomingBytes) / (1024 * 1024)
      if (totalMb > limits.maxTotalMb) {
        toast({
          title: '超过总大小限制',
          description: `所有图片合计需 ≤ ${limits.maxTotalMb}MB，请压缩后再试`,
          variant: 'destructive',
        })
        return
      }
      if (selectedImages.length + files.length > limits.maxCount) {
        toast({
          title: '超过数量限制',
          description: `每次最多上传 ${limits.maxCount} 张图片`,
          variant: 'destructive',
        })
        return
      }

      for (const file of files) {
        const result = await validateImage(file)
        if (!result.ok) {
          toast({
            title: '图片不符合要求',
            description: result.reason || '图片校验失败',
            variant: 'destructive',
          })
        } else if (result.dataUrl && result.mime && typeof result.size === 'number') {
          setSelectedImages((prev) => [...prev, { dataUrl: result.dataUrl!, mime: result.mime!, size: result.size! }])
        }
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [limits.maxCount, limits.maxTotalMb, selectedImages, toast, validateImage],
  )

  const removeImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, idx) => idx !== index))
  }, [])

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!isVisionEnabled) {
        return
      }

      const items = event.clipboardData?.items
      if (!items) return

      const imageFiles: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            imageFiles.push(file)
          }
        }
      }

      if (imageFiles.length === 0) {
        return
      }

      event.preventDefault()

      const existingBytes = selectedImages.reduce((sum, img) => sum + img.size, 0)
      const incomingBytes = imageFiles.reduce((sum, file) => sum + file.size, 0)
      const totalMb = (existingBytes + incomingBytes) / (1024 * 1024)

      if (totalMb > limits.maxTotalMb) {
        toast({
          title: '超过总大小限制',
          description: `所有图片合计需 ≤ ${limits.maxTotalMb}MB，请压缩后再试`,
          variant: 'destructive',
        })
        return
      }

      if (selectedImages.length + imageFiles.length > limits.maxCount) {
        toast({
          title: '超过数量限制',
          description: `每次最多上传 ${limits.maxCount} 张图片`,
          variant: 'destructive',
        })
        return
      }

      for (const file of imageFiles) {
        const result = await validateImage(file)
        if (!result.ok) {
          toast({
            title: '图片不符合要求',
            description: result.reason || '图片校验失败',
            variant: 'destructive',
          })
        } else if (result.dataUrl && result.mime && typeof result.size === 'number') {
          setSelectedImages((prev) => [...prev, { dataUrl: result.dataUrl!, mime: result.mime!, size: result.size! }])
        }
      }
    },
    [isVisionEnabled, limits.maxCount, limits.maxTotalMb, selectedImages, toast, validateImage],
  )

  const exposedLimits = useMemo(() => ({ ...limits }), [limits])

  return {
    fileInputRef,
    selectedImages,
    setSelectedImages,
    pickImages,
    onFilesSelected,
    removeImage,
    validateImage,
    handlePaste,
    limits: exposedLimits,
  }
}
