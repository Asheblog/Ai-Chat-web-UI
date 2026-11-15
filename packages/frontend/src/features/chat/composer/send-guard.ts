export interface SendableContentCounts {
  text: string
  /** 已就绪（status=ready）的工作区文件数量。 */
  readyFiles: number
  /** 图片附件数量。 */
  images: number
}

/**
 * 可发送判定（欢迎页、会话页、键盘与程序化提交共用一份）：
 * 文字、已就绪的工作区文件、图片附件任一存在即可发送。图片与文件走同一发送链路，
 * 因此“只有图片”必须是可发送状态——否则界面显示可发、提交却被静默丢弃。
 */
export const hasSendableContent = ({ text, readyFiles, images }: SendableContentCounts): boolean =>
  text.trim().length > 0 || readyFiles > 0 || images > 0

/** 无文字时随消息发送的回退指令：文件优先，其次图片；都没有则为空串。 */
export const buildAttachmentFallbackPrompt = ({ readyFiles, images }: { readyFiles: number; images: number }): string => {
  if (readyFiles > 0) return '请分析工作区中的文件'
  if (images > 0) return '请查看这些图片'
  return ''
}
