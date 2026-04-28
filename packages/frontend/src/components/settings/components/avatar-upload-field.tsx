'use client'

import { useRef, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Camera } from 'lucide-react'

export interface AvatarUploadResult {
  data: string
  mime: string
  previewUrl: string
}

interface AvatarUploadFieldProps {
  imageUrl?: string | null
  fallbackText?: string
  description?: string
  uploading?: boolean
  disabled?: boolean
  onUpload: (result: AvatarUploadResult) => void | Promise<void>
  onClear?: () => void
  clearDisabled?: boolean
  uploadText?: string
  clearText?: string
  className?: string
  onError?: (message: string) => void
  avatarSize?: number
  variant?: 'default' | 'profile'
}

const MAX_AVATAR_BYTES = 1024 * 1024

export function AvatarUploadField({
  imageUrl,
  fallbackText = 'A',
  description,
  uploading = false,
  disabled = false,
  onUpload,
  onClear,
  clearDisabled = false,
  uploadText = '上传头像',
  clearText = '恢复默认',
  className,
  onError,
  avatarSize = 64,
  variant = 'default',
}: AvatarUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) {
      onError?.('头像大小需小于 1MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        onError?.('无法读取头像文件')
        return
      }
      const segments = result.split(',')
      const base64 = segments[1]
      if (!base64) {
        onError?.('头像格式不受支持')
        return
      }
      const payload: AvatarUploadResult = {
        data: base64,
        mime: file.type || 'image/png',
        previewUrl: result,
      }
      void onUpload(payload)
    }
    reader.onerror = () => {
      onError?.('读取头像失败，请重试')
    }
    reader.readAsDataURL(file)
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleFileChange}
      disabled={disabled || uploading}
    />
  )

  if (variant === 'profile') {
    return (
      <div className={cn('flex flex-col items-center gap-2 text-center', className)}>
        <div className="relative rounded-full bg-gradient-to-b from-blue-400 to-blue-600 p-1 shadow-[0_16px_32px_rgba(37,99,235,0.16)]">
          <Avatar
            className="border-4 border-white bg-blue-50"
            style={{ height: avatarSize, width: avatarSize }}
          >
            <AvatarImage src={imageUrl || undefined} alt="头像" />
            <AvatarFallback className="text-lg font-semibold text-slate-700">{fallbackText}</AvatarFallback>
          </Avatar>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={uploading ? '头像上传中' : uploadText}
            title={uploading ? '头像上传中' : uploadText}
            disabled={uploading || disabled}
            onClick={() => inputRef.current?.click()}
            className="absolute bottom-1 right-1 h-8 w-8 rounded-full border-background bg-card text-foreground shadow-[0_8px_18px_hsl(var(--background)/0.55)] hover:bg-accent hover:text-primary"
          >
            <Camera className="h-4 w-4" />
          </Button>
        </div>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        <div className="min-h-[22px] text-xs text-slate-500">
          {uploading ? '上传中...' : imageUrl ? '头像已设置' : '点击相机上传'}
        </div>
        {onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading || disabled || clearDisabled}
            onClick={() => onClear?.()}
            className="h-8 text-xs"
          >
            {clearText}
          </Button>
        ) : null}
        {input}
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <Avatar className="shrink-0" style={{ height: avatarSize, width: avatarSize }}>
        <AvatarImage src={imageUrl || undefined} alt="头像" />
        <AvatarFallback>{fallbackText}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        {description ? <p>{description}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={uploading || disabled}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? '上传中...' : uploadText}
          </Button>
          {onClear ? (
            <Button
              type="button"
              variant="ghost"
              disabled={uploading || disabled || clearDisabled}
              onClick={() => onClear?.()}
            >
              {clearText}
            </Button>
          ) : null}
        </div>
      </div>
      {input}
    </div>
  )
}
