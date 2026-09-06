import type { MultiModelBattleStreamPayload } from '../api'
import { hasBattleContent, isVisionCapable, toBattleUploadImages } from './model-config'
import { parseCustomBody, sanitizeHeaders } from './validation'
import type { BattleDraftImage, JudgeConfig, ModelConfigState } from './types'

export type BattlePayloadValidation = ReturnType<typeof buildBattlePayload>

export const buildBattlePayload = (params: {
  prompt: string
  promptImages: BattleDraftImage[]
  expectedAnswer: string
  expectedAnswerImages: BattleDraftImage[]
  judgeConfig: JudgeConfig
  selectedModels: ModelConfigState[]
  imageOverrides?: {
    promptImages?: BattleDraftImage[]
    expectedAnswerImages?: BattleDraftImage[]
  }
}): {
  valid: boolean;
  payload?: MultiModelBattleStreamPayload;
  error?: string;
  updatedConfigs?: ModelConfigState[];
} => {
  const {
    prompt,
    promptImages,
    expectedAnswer,
    expectedAnswerImages,
    judgeConfig,
    selectedModels,
    imageOverrides,
  } = params
  const effectivePromptImages = Array.isArray(imageOverrides?.promptImages)
    ? imageOverrides.promptImages
    : promptImages
  const effectiveExpectedAnswerImages = Array.isArray(imageOverrides?.expectedAnswerImages)
    ? imageOverrides.expectedAnswerImages
    : expectedAnswerImages
  const promptText = prompt.trim()
  const expectedAnswerText = expectedAnswer.trim()
  const promptHasImages = effectivePromptImages.length > 0
  const expectedAnswerHasImages = effectiveExpectedAnswerImages.length > 0

  if (!hasBattleContent(prompt, effectivePromptImages)) {
    return { valid: false, error: '请输入问题或上传题目图片' }
  }
  if (!hasBattleContent(expectedAnswer, effectiveExpectedAnswerImages)) {
    return { valid: false, error: '请输入期望答案或上传答案图片' }
  }
  if (!judgeConfig.model) {
    return { valid: false, error: '请选择裁判模型' }
  }
  if (selectedModels.length === 0) {
    return { valid: false, error: '至少选择一个参赛模型' }
  }
  if (judgeConfig.passK > judgeConfig.runsPerModel) {
    return { valid: false, error: 'pass@k 不能大于运行次数' }
  }

  if (promptHasImages) {
    if (!isVisionCapable(judgeConfig.model)) {
      return { valid: false, error: '题目包含图片时，裁判模型必须支持 Vision' }
    }
    const unsupportedContestants = selectedModels
      .filter((item) => !isVisionCapable(item.model))
      .map((item) => item.model.name || item.model.id)
    if (unsupportedContestants.length > 0) {
      return {
        valid: false,
        error: `题目包含图片时，以下参赛模型不支持 Vision：${unsupportedContestants.join('、')}`,
      }
    }
  } else if (expectedAnswerHasImages && !isVisionCapable(judgeConfig.model)) {
    return { valid: false, error: '答案包含图片时，裁判模型必须支持 Vision' }
  }

  const modelPayloads: MultiModelBattleStreamPayload['models'] = []
  let hasError = false
  const updatedConfigs: ModelConfigState[] = []

  for (const item of selectedModels) {
    const bodyResult = parseCustomBody(item.customBody)
    const headerResult = sanitizeHeaders(item.customHeaders)
    const extraPrompt = item.extraPrompt.trim()

    const config: ModelConfigState = {
      ...item,
      customBodyError: bodyResult.error,
    }
    updatedConfigs.push(config)

    if (bodyResult.error) {
      hasError = true
      continue
    }
    if (!headerResult.ok) {
      hasError = true
      continue
    }

    const enabledSkills: string[] = []
    if (item.webSearchEnabled) enabledSkills.push('web-search', 'url-reader')
    if (item.pythonEnabled) enabledSkills.push('python-runner')

    modelPayloads.push({
      modelId: item.model.id,
      connectionId: item.model.connectionId,
      rawId: item.model.rawId,
      skills: {
        builtin: Array.from(new Set(enabledSkills)),
        enabled: [],
      },
      ...(extraPrompt ? { extraPrompt } : {}),
      custom_body: bodyResult.value,
      custom_headers: headerResult.headers,
      reasoningEnabled: item.reasoningEnabled,
      reasoningEffort: item.reasoningEffort,
      ollamaThink: item.ollamaThink,
    })
  }

  if (hasError) {
    return {
      valid: false,
      error: '请修正自定义请求配置',
      updatedConfigs
    }
  }

  const promptPayload: MultiModelBattleStreamPayload['prompt'] = {}
  if (promptText) {
    promptPayload.text = promptText
  }
  const promptUploadImages = toBattleUploadImages(effectivePromptImages)
  if (promptUploadImages.length > 0) {
    promptPayload.images = promptUploadImages
  }

  const expectedAnswerPayload: MultiModelBattleStreamPayload['expectedAnswer'] = {}
  if (expectedAnswerText) {
    expectedAnswerPayload.text = expectedAnswerText
  }
  const expectedAnswerUploadImages = toBattleUploadImages(effectiveExpectedAnswerImages)
  if (expectedAnswerUploadImages.length > 0) {
    expectedAnswerPayload.images = expectedAnswerUploadImages
  }

  const payload: MultiModelBattleStreamPayload = {
    mode: 'multi_model',
    prompt: promptPayload,
    expectedAnswer: expectedAnswerPayload,
    judge: {
      modelId: judgeConfig.model.id,
      connectionId: judgeConfig.model.connectionId,
      rawId: judgeConfig.model.rawId,
    },
    judgeThreshold: judgeConfig.threshold,
    runsPerModel: judgeConfig.runsPerModel,
    passK: judgeConfig.passK,
    maxConcurrency: judgeConfig.maxConcurrency,
    models: modelPayloads,
  }

  return { valid: true, payload, updatedConfigs }
}
