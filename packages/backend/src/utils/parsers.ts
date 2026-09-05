/**
 * 通用解析工具函数库
 *
 * 实现已收敛至 @aichat/shared/config-parsers（backend / frontend 共用）。
 * 本文件保留为兼容再导出，避免存量 import 路径迁移。
 */
export {
  clampNumber,
  parseBooleanSetting,
  parseDomainListSetting,
  parseEnumSetting,
  parseFloatSetting,
  parseNumberSetting,
  truncateText,
} from '@aichat/shared/config-parsers'
