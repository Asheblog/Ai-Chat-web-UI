'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'

interface ImageLightboxProps {
  images: string[]
  initialIndex?: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImageLightbox({
  images,
  initialIndex = 0,
  open,
  onOpenChange,
}: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setCurrentIndex(initialIndex)
      setScale(1)
      setRotation(0)
    }
  }, [open, initialIndex])

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
    setScale(1)
    setRotation(0)
  }, [images.length])

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
    setScale(1)
    setRotation(0)
  }, [images.length])

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5))
  }, [])

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          handlePrev()
          break
        case 'ArrowRight':
          handleNext()
          break
        case 'Escape':
          onOpenChange(false)
          break
        case '+':
        case '=':
          handleZoomIn()
          break
        case '-':
          handleZoomOut()
          break
        case 'r':
        case 'R':
          handleRotate()
          break
      }
    },
    [handlePrev, handleNext, handleZoomIn, handleZoomOut, handleRotate, onOpenChange]
  )

  if (images.length === 0) return null

  const currentImage = images[currentIndex]
  const hasMultipleImages = images.length > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center focus:outline-none"
          onKeyDown={handleKeyDown}
        >
          {/* Close button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            aria-label="关闭"
          >
            <X className="h-6 w-6" />
          </button>

          {/* Navigation arrows */}
          {hasMultipleImages && (
            <>
              <button
                onClick={handlePrev}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-50 p-3 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                aria-label="上一张"
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-50 p-3 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                aria-label="下一张"
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}

          {/* Toolbar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-black/50">
            <button
              onClick={handleZoomOut}
              className="p-2 rounded-full text-white hover:bg-white/20 transition-colors"
              aria-label="缩小"
              disabled={scale <= 0.5}
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="text-white text-sm min-w-[50px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-2 rounded-full text-white hover:bg-white/20 transition-colors"
              aria-label="放大"
              disabled={scale >= 3}
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <div className="w-px h-6 bg-white/30 mx-1" />
            <button
              onClick={handleRotate}
              className="p-2 rounded-full text-white hover:bg-white/20 transition-colors"
              aria-label="旋转"
            >
              <RotateCw className="h-5 w-5" />
            </button>
            {hasMultipleImages && (
              <>
                <div className="w-px h-6 bg-white/30 mx-1" />
                <span className="text-white text-sm">
                  {currentIndex + 1} / {images.length}
                </span>
              </>
            )}
          </div>

          {/* Image container */}
          <div className="relative w-full h-full flex items-center justify-center p-16">
            <div
              className="relative max-w-full max-h-full transition-transform duration-200"
              style={{
                transform: `scale(${scale}) rotate(${rotation}deg)`,
              }}
            >
              <Image
                src={currentImage}
                alt={`图片 ${currentIndex + 1}`}
                width={1200}
                height={800}
                unoptimized
                className="max-w-full max-h-[calc(100vh-8rem)] object-contain"
                priority
              />
            </div>
          </div>

          {/* Thumbnail strip for multiple images */}
          {hasMultipleImages && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg bg-black/50 max-w-[80vw] overflow-x-auto">
              {images.map((src, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentIndex(idx)
                    setScale(1)
                    setRotation(0)
                  }}
                  className={cn(
                    'relative flex-shrink-0 w-12 h-12 rounded border-2 overflow-hidden transition-all',
                    idx === currentIndex
                      ? 'border-white opacity-100'
                      : 'border-transparent opacity-60 hover:opacity-100'
                  )}
                >
                  <Image
                    src={src}
                    alt={`缩略图 ${idx + 1}`}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

// Hook for easy usage
export function useImageLightbox() {
  const [state, setState] = useState<{
    open: boolean
    images: string[]
    initialIndex: number
  }>({
    open: false,
    images: [],
    initialIndex: 0,
  })

  const openLightbox = useCallback((images: string[], initialIndex = 0) => {
    setState({
      open: true,
      images,
      initialIndex,
    })
  }, [])

  const closeLightbox = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const setOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, open }))
  }, [])

  return {
    ...state,
    openLightbox,
    closeLightbox,
    setOpen,
  }
}

// Clickable image component
interface ClickableImageProps {
  src: string
  alt?: string
  className?: string
  width?: number
  height?: number
  allImages?: string[]
  imageIndex?: number
  onOpenLightbox?: (images: string[], index: number) => void
}

export function ClickableImage({
  src,
  alt = '图片',
  className,
  width = 160,
  height = 160,
  allImages,
  imageIndex = 0,
  onOpenLightbox,
}: ClickableImageProps) {
  const handleClick = () => {
    if (onOpenLightbox) {
      onOpenLightbox(allImages ?? [src], imageIndex)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className={cn('rounded border object-contain', className)}
      />
    </button>
  )
}