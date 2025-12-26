'use client'

import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { imageUploadVariants } from '@/lib/animations/chat'
import { cn } from '@/lib/utils'
import { ImageLightbox, useImageLightbox } from '@/components/ui/image-lightbox'

interface ChatImagePreviewProps {
  images: ChatComposerImage[]
  onRemove: (index: number) => void
  className?: string
}

export function ChatImagePreview({ images, onRemove, className }: ChatImagePreviewProps) {
  const lightbox = useImageLightbox()

  if (images.length === 0) {
    return null
  }

  const imageUrls = images.map((img) => img.dataUrl)

  return (
    <div className={cn('mb-2 flex flex-wrap gap-2', className)}>
      <AnimatePresence mode="popLayout">
        {images.map((img, idx) => (
          <motion.div
            key={`${img.dataUrl}-${idx}`}
            variants={imageUploadVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            whileHover="hover"
            className="relative border rounded p-1"
            layout
          >
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
              <Image
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
              className="absolute -top-2 -right-2 bg-background border rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground transition-colors z-10"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(idx)
              }}
              aria-label="移除图片"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <ImageLightbox
        images={imageUrls}
        initialIndex={lightbox.initialIndex}
        open={lightbox.open}
        onOpenChange={lightbox.setOpen}
      />
    </div>
  )
}
