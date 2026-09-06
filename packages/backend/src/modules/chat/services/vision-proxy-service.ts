/**
 * VisionProxyService 已迁移至 services/vision。
 * 本文件保留为兼容再导出，避免存量 chat 模块 import 路径迁移。
 */
export {
  VisionProxyService,
  VisionProxyServiceError,
  applyVisionReasoningOptions,
  buildVisionAttachmentHint,
  isVisionProxyReady,
  loadHistoryImageDescriptions,
  loadVisionProxyConfig,
  parseStoredImageDescriptions,
  shouldSendVisionReasoningEffort,
  type ImageDescription,
  type VisionProxyConfig,
  type VisionProxyServiceDeps,
} from '../../../services/vision/vision-proxy-service'
