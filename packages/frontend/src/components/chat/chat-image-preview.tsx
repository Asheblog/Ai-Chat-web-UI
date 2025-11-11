'use client'

import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { ChatComposerImage } from '@/hooks/use-chat-composer'
import { imageUploadVariants } from '@/lib/animations'
import { cn } from '@/lib/utils'

interface ChatImagePreviewProps {
  images: ChatComposerImage[]
  onRemove: (index: number) => void
  className?: string
}

export function ChatImagePreview({ images, onRemove, className }: ChatImagePreviewProps) {
  if (images.length === 0) {
    return null
  }

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
            <Image
              src={img.dataUrl}
              alt={`预览图片 ${idx + 1}`}
              width={80}
              height={80}
              unoptimized
              className="h-20 w-20 object-contain rounded"
            />
            <button
              type="button"
              className="absolute -top-2 -right-2 bg-background border rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground transition-colors"
              onClick={() => onRemove(idx)}
              aria-label="移除图片"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
