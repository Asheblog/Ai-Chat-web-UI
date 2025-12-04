import NextImage from 'next/image'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComposerImage } from '@/features/chat/composer'

interface ImagePreviewListProps {
  images: ComposerImage[]
  onRemove: (index: number) => void
}

export function ImagePreviewList({ images, onRemove }: ImagePreviewListProps) {
  if (!images.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((img, idx) => (
        <div key={`preview-${idx}`} className="relative border rounded p-1">
          <NextImage
            src={img.dataUrl}
            alt={`预览图片 ${idx + 1}`}
            width={80}
            height={80}
            unoptimized
            className="h-20 w-20 object-contain rounded"
          />
          <button
            type="button"
            className={cn(
              'absolute -top-2 -right-2 bg-background border rounded-full p-1 text-muted-foreground',
              'hover:text-foreground transition',
            )}
            aria-label="移除图片"
            onClick={() => onRemove(idx)}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
