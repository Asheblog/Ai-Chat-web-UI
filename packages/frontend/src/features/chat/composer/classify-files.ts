/**
 * 文件分类结果
 */
export interface ClassifiedFiles {
  /** 被识别为目录的条目（会拒绝上传） */
  directories: File[]
  /** 被识别为图片且模型支持 vision 的文件 */
  images: File[]
  /** 其他文件（或 vision 不可用时的图片） */
  others: File[]
}

/**
 * 对 FileList 或 File[] 进行分类，供拖拽上传和统一文件选择器共用。
 *
 * 分类规则：
 * - size === 0 && type === '' → directories
 * - type.startsWith('image/') 且模型支持 vision → images
 * - 其余 → others
 *
 * 图片归属只由 isVisionEnabled 决定：模型不支持 vision 时图片按工作区文件处理。
 */
export function classifyFiles(
  fileList: FileList | File[],
  options: { isVisionEnabled: boolean },
): ClassifiedFiles {
  const files = Array.from(fileList)
  const directories: File[] = []
  const images: File[] = []
  const others: File[] = []

  for (const file of files) {
    if (file.size === 0 && file.type === '') {
      directories.push(file)
    } else if (file.type.startsWith('image/') && options.isVisionEnabled) {
      images.push(file)
    } else {
      others.push(file)
    }
  }

  return { directories, images, others }
}
