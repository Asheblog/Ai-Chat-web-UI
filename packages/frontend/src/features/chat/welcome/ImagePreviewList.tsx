import NextImage from 'next/image'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComposerImage } from '@/features/chat/composer'
import { ImageLightbox, useImageLightbox } from '@/components/ui/image-lightbox'

interface ImagePreviewListProps {
  images: ComposerImage[]
  onRemove: (index: number) => void
}

export function ImagePreviewList({ images, onRemove }: ImagePreviewListProps) {
  const lightbox = useImageLightbox()

  if (!images.length) return null

  const imageUrls = images.map((img) => img.dataUrl)

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((img, idx) => (
        <div key={`preview-${idx}`} className="relative border rounded p-1">
          <div
            role="button"
            tabIndex={0}
            onClick={() => lightbox.openLightbox(imageUrls, idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                lightbox.openLightbox(imageUrls, idx)
              }
            }}
            className="inline-flex cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
          >
            <NextImage
              src={img.dataUrl}
              alt={`预览图片 ${idx + 1}`}
              width={80}
              height={80}
              unoptimized
              className="h-20 w-20 object-contain rounded hover:opacity-90 transition-opacity block"
            />
          </div>
          <button
            type="button"
            className={cn(
              'absolute -top-2 -right-2 bg-background border rounded-full p-1 text-muted-foreground z-10',
              'hover:text-foreground transition',
            )}
            aria-label="移除图片"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(idx)
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <ImageLightbox
        images={imageUrls}
        initialIndex={lightbox.initialIndex}
        open={lightbox.open}
        onOpenChange={lightbox.setOpen}
      />
    </div>
  )
}
