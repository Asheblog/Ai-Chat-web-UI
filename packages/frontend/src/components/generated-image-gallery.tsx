'use client'

import React, { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ImageLightbox } from './ui/image-lightbox'
import type { GeneratedImage } from '@/types'

interface GeneratedImageGalleryProps {
  images: GeneratedImage[]
  className?: string
}

/**
 * AI 生成图片画廊组件
 *
 * 展示生图模型生成的图片，支持：
 * - 网格布局展示多张图片
 * - 点击放大查看
 * - 显示修正后的提示词 (revised_prompt)
 * - 下载功能
 */
export function GeneratedImageGallery({ images, className }: GeneratedImageGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // 转换为 ImageLightbox 需要的 string[] 格式
  const imageSrcs = useMemo(() => {
    return images.map(img => getImageSrc(img))
  }, [images])

  if (!images || images.length === 0) {
    return null
  }

  const handleImageClick = (index: number) => {
    setSelectedIndex(index)
    setLightboxOpen(true)
  }

  return (
    <GeneratedImageGalleryInner
      images={images}
      imageSrcs={imageSrcs}
      className={className}
      lightboxOpen={lightboxOpen}
      selectedIndex={selectedIndex}
      onImageClick={handleImageClick}
      onLightboxOpenChange={setLightboxOpen}
    />
  )
}

function getImageSrc(image: GeneratedImage): string {
    if (image.url) {
      return image.url
    }
    if (image.base64) {
      const mime = image.mime || 'image/png'
      return `data:${mime};base64,${image.base64}`
    }
    return ''
  }

function handleDownload(image: GeneratedImage, index: number) {
  const src = getImageSrc(image)
  if (!src) return

  const link = document.createElement('a')
  link.href = src
  link.download = `generated-image-${index + 1}.${image.mime?.split('/')[1] || 'png'}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

interface GeneratedImageGalleryInnerProps {
  images: GeneratedImage[]
  imageSrcs: string[]
  className?: string
  lightboxOpen: boolean
  selectedIndex: number
  onImageClick: (index: number) => void
  onLightboxOpenChange: (open: boolean) => void
}

function GeneratedImageGalleryInner({
  images,
  imageSrcs,
  className,
  lightboxOpen,
  selectedIndex,
  onImageClick,
  onLightboxOpenChange,
}: GeneratedImageGalleryInnerProps) {
  if (!images || images.length === 0) {
    return null
  }

  // 单张图片布局
  if (images.length === 1) {
    const image = images[0]
    const src = imageSrcs[0]
    
    return (
      <div className={cn('mt-3', className)}>
        <div className="relative group max-w-md">
          <img
            src={src}
            alt={image.revisedPrompt || 'AI generated image'}
            className="rounded-lg cursor-pointer shadow-md hover:shadow-lg transition-shadow w-full"
            onClick={() => onImageClick(0)}
          />
          {/* 操作按钮 */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDownload(image, 0)
              }}
              className="p-2 bg-black/50 hover:bg-black/70 rounded-full text-white"
              title="下载图片"
            >
              <DownloadIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {image.revisedPrompt && (
          <p className="text-xs text-muted-foreground mt-2 italic">
            {image.revisedPrompt}
          </p>
        )}
        <ImageLightbox
          images={imageSrcs}
          initialIndex={selectedIndex}
          open={lightboxOpen}
          onOpenChange={onLightboxOpenChange}
        />
      </div>
    )
  }

  // 多张图片网格布局
  const gridCols = images.length === 2 ? 'grid-cols-2' :
                   images.length === 3 ? 'grid-cols-3' :
                   'grid-cols-2 md:grid-cols-4'

  return (
    <div className={cn('mt-3', className)}>
      <div className={cn('grid gap-2', gridCols)}>
        {images.map((image, index) => {
          const src = imageSrcs[index]
          return (
            <div key={index} className="relative group">
              <img
                src={src}
                alt={image.revisedPrompt || `AI generated image ${index + 1}`}
                className="rounded-lg cursor-pointer shadow-md hover:shadow-lg transition-shadow w-full aspect-square object-cover"
                onClick={() => onImageClick(index)}
              />
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(image, index)
                  }}
                  className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white"
                  title="下载图片"
                >
                  <DownloadIcon className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {/* 如果有 revisedPrompt，显示第一张的 */}
      {images[0]?.revisedPrompt && (
        <p className="text-xs text-muted-foreground mt-2 italic">
          {images[0].revisedPrompt}
        </p>
      )}
      <ImageLightbox
        images={imageSrcs}
        initialIndex={selectedIndex}
        open={lightboxOpen}
        onOpenChange={onLightboxOpenChange}
      />
    </div>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}