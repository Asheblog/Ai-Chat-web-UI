'use client'

import { useImageLightbox, ImageLightbox } from '@/components/ui/image-lightbox'
import { cn } from '@/lib/utils'

interface BattleContentBlockProps {
  title: string
  text: string
  images: string[]
  compact?: boolean
  className?: string
}

export function BattleContentBlock({ title, text, images, compact = false, className }: BattleContentBlockProps) {
  const lightbox = useImageLightbox()
  const trimmed = (text || '').trim()
  const hasImages = Array.isArray(images) && images.length > 0

  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-[11px] font-medium tracking-[0.5px] text-ink-tertiary">{title}</div>
      {trimmed ? (
        <div className={cn('whitespace-pre-wrap text-[13.5px] leading-[1.75] text-foreground', compact && 'line-clamp-3')}>
          {trimmed}
        </div>
      ) : (
        <div className="text-[12.5px] text-ink-tertiary">（无文本）</div>
      )}

      {hasImages && (
        <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-3')}>
          {images.map((url, index) => (
            <button
              key={`${url}-${index}`}
              type="button"
              className="relative overflow-hidden rounded-[10px] border border-border bg-surface transition-colors duration-[160ms] hover:border-borderStrong"
              onClick={() => lightbox.openLightbox(images, index)}
            >
              <img
                src={url}
                alt={`${title} 图片 ${index + 1}`}
                className={cn('w-full object-contain', compact ? 'h-16' : 'h-28')}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      <ImageLightbox
        images={images}
        initialIndex={lightbox.initialIndex}
        open={lightbox.open}
        onOpenChange={lightbox.setOpen}
      />
    </div>
  )
}
