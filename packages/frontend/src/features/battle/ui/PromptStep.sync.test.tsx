import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PromptStep } from './PromptStep'
import type { BattleDraftImage } from '../hooks/useBattleFlow'

const toastMock = vi.fn()

let promptSelectedImages: BattleDraftImage[] = []
let expectedSelectedImages: BattleDraftImage[] = []

const promptSetSelectedImages = vi.fn((images: BattleDraftImage[]) => {
  promptSelectedImages = images
})
const expectedSetSelectedImages = vi.fn((images: BattleDraftImage[]) => {
  expectedSelectedImages = images
})

const noop = () => {}

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/features/chat/welcome/ImagePreviewList', () => ({
  ImagePreviewList: () => null,
}))

let hookCallCount = 0

vi.mock('@/features/chat/composer', () => ({
  useImageAttachments: () => {
    const isPrompt = hookCallCount % 2 === 0
    hookCallCount += 1
    if (isPrompt) {
      return {
        fileInputRef: { current: null },
        selectedImages: promptSelectedImages,
        setSelectedImages: promptSetSelectedImages,
        pickImages: noop,
        onFilesSelected: noop,
        removeImage: noop,
        validateImage: vi.fn(),
        handlePaste: noop,
        limits: { maxCount: 4, maxMb: 15, maxEdge: 8192, maxTotalMb: 60 },
      }
    }
    return {
      fileInputRef: { current: null },
      selectedImages: expectedSelectedImages,
      setSelectedImages: expectedSetSelectedImages,
      pickImages: noop,
      onFilesSelected: noop,
      removeImage: noop,
      validateImage: vi.fn(),
      handlePaste: noop,
      limits: { maxCount: 4, maxMb: 15, maxEdge: 8192, maxTotalMb: 60 },
    }
  },
}))

describe('PromptStep image sync', () => {
  beforeEach(() => {
    promptSelectedImages = []
    expectedSelectedImages = []
    hookCallCount = 0
    promptSetSelectedImages.mockClear()
    expectedSetSelectedImages.mockClear()
    toastMock.mockClear()
  })

  it('does not push local image state back to hook when parent props have not changed yet', () => {
    const onPromptImagesChange = vi.fn()
    const baseProps = {
      prompt: '',
      expectedAnswer: '',
      promptImages: [] as BattleDraftImage[],
      expectedAnswerImages: [] as BattleDraftImage[],
      selectedModels: [],
      judgeConfig: {
        model: null,
        threshold: 0.8,
        runsPerModel: 1,
        passK: 1,
        maxConcurrency: 3,
      },
      onPromptChange: noop,
      onExpectedAnswerChange: noop,
      onPromptImagesChange,
      onExpectedAnswerImagesChange: noop,
      onBack: noop,
      onStart: noop,
      canStart: false,
      isRunning: false,
    }

    const view = render(<PromptStep {...baseProps} />)
    promptSetSelectedImages.mockClear()
    hookCallCount = 0

    const localSelection: BattleDraftImage[] = [
      {
        dataUrl: 'data:image/png;base64,AAAA',
        mime: 'image/png',
        size: 10,
      },
    ]
    promptSelectedImages = localSelection

    view.rerender(<PromptStep {...baseProps} />)

    expect(onPromptImagesChange).toHaveBeenCalledWith(localSelection)
    expect(promptSetSelectedImages).not.toHaveBeenCalled()
  })

  it('passes latest local image selection when starting battle', () => {
    const onStart = vi.fn()
    const onPromptImagesChange = vi.fn()
    const onExpectedAnswerImagesChange = vi.fn()
    promptSelectedImages = [
      {
        dataUrl: 'data:image/png;base64,AAAA',
        mime: 'image/png',
        size: 10,
      },
    ]
    expectedSelectedImages = [
      {
        dataUrl: 'data:image/jpeg;base64,BBBB',
        mime: 'image/jpeg',
        size: 12,
      },
    ]

    const props = {
      prompt: '识别图片有什么问题',
      expectedAnswer: '答案：一度房室传导阻滞',
      promptImages: [] as BattleDraftImage[],
      expectedAnswerImages: [] as BattleDraftImage[],
      selectedModels: [],
      judgeConfig: {
        model: null,
        threshold: 0.8,
        runsPerModel: 1,
        passK: 1,
        maxConcurrency: 3,
      },
      onPromptChange: noop,
      onExpectedAnswerChange: noop,
      onPromptImagesChange,
      onExpectedAnswerImagesChange,
      onBack: noop,
      onStart,
      canStart: true,
      isRunning: false,
    }

    render(<PromptStep {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '开始对战' }))

    expect(onStart).toHaveBeenCalledWith({
      promptImages: promptSelectedImages,
      expectedAnswerImages: expectedSelectedImages,
    })
  })
})
