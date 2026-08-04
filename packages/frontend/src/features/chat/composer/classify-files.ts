/**
 * 文件分类结果
 */
export interface ClassifiedFiles {
  /** 被识别为目录的条目（会拒绝上传） */
  directories: File[]
  /** 被识别为图片且当前可附加（vision 或转写代理）的文件 */
  images: File[]
  /** 其他文件（或 vision 不可用时的图片） */
  others: File[]
}

/**
 * 对 FileList 或 File[] 进行分类，供拖拽上传和统一文件选择器共用。
 *
 * 分类规则：
 * - size === 0 && type === '' → directories
 * - type.startsWith('image/') → images（若图片不可附加则归入 others）
 * - 其余 → others
 *
 * canAttachImages 可选：图片转写代理就绪时即使 isVisionEnabled 为 false 也允许加图；
 * 未传入时回退到 isVisionEnabled，保持既有行为。
 */
export function classifyFiles(
  fileList: FileList | File[],
  options: { isVisionEnabled: boolean; canAttachImages?: boolean },
): ClassifiedFiles {
  const files = Array.from(fileList)
  const directories: File[] = []
  const images: File[] = []
  const others: File[] = []
  const canAttachImages = options.canAttachImages ?? options.isVisionEnabled

  for (const file of files) {
    if (file.size === 0 && file.type === '') {
      directories.push(file)
    } else if (file.type.startsWith('image/') && canAttachImages) {
      images.push(file)
    } else {
      others.push(file)
    }
  }

  return { directories, images, others }
}
