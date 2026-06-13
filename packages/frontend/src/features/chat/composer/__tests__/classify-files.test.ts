import { describe, it, expect } from 'vitest'
import { classifyFiles } from '../classify-files'

describe('classifyFiles', () => {
  it('separates images from other files when vision is enabled', () => {
    const files = [
      new File([''], 'photo.jpg', { type: 'image/jpeg' }),
      new File([''], 'doc.pdf', { type: 'application/pdf' }),
    ]
    const result = classifyFiles(files, { isVisionEnabled: true })
    expect(result.images).toHaveLength(1)
    expect(result.others).toHaveLength(1)
    expect(result.directories).toHaveLength(0)
  })

  it('routes images to others when vision is disabled', () => {
    const files = [new File([''], 'photo.jpg', { type: 'image/jpeg' })]
    const result = classifyFiles(files, { isVisionEnabled: false })
    expect(result.images).toHaveLength(0)
    expect(result.others).toHaveLength(1)
  })

  it('detects directories by size 0 and empty type', () => {
    const files = [new File([], 'folder')]
    const result = classifyFiles(files, { isVisionEnabled: false })
    expect(result.directories).toHaveLength(1)
  })

  it('handles empty file list', () => {
    const result = classifyFiles([], { isVisionEnabled: true })
    expect(result.images).toHaveLength(0)
    expect(result.others).toHaveLength(0)
    expect(result.directories).toHaveLength(0)
  })
})
