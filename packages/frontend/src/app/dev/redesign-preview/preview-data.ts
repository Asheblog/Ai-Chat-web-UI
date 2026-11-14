import type { ModelItem } from '@/store/models-store'
import type { MessageMeta, ToolEvent } from '@/types'

export const previewModels: ModelItem[] = [
  ['deepseek-v4.1-flash', 'DeepSeek', 1, 'DeepSeek'],
  ['deepseek-v4-pro', 'DeepSeek', 1, 'DeepSeek'],
  ['deepseek-v4-flash', 'DeepSeek', 1, 'DeepSeek'],
  ['gpt-4o-audio-preview', 'OpenAI', 2, 'OpenAI'],
  ['gpt-4o-realtime-preview', 'OpenAI', 2, 'OpenAI'],
  ['deepseek-v4.1-flash', 'DeepSeek', 3, 'DeepSeek 备用线路'],
  ['research-model-with-a-very-long-descriptive-name-for-overflow-testing', 'OpenAI', 4, '研究团队自定义供应商连接名称用于检查长文本'],
].map(([name, provider, connectionId, displayName]) => ({
  id: String(name), rawId: String(name), name: String(name), provider: String(provider),
  connectionId: Number(connectionId), displayName: String(displayName), channelName: String(displayName),
  connectionBaseUrl: 'https://example.com/v1', modelType: 'chat' as const,
}))

export const previewReasoning = ['先核对用户的问题。', '检查相关资料与来源。', '整理信息并核对差异。', '补充阅读后形成回答。'].join('\n')
const now = Date.parse('2026-11-14T10:00:00Z')
export const previewTools: ToolEvent[] = Array.from({ length: 9 }, (_, index) => ({
  id: 'preview-tool-' + index, callId: 'preview-call-' + index, sessionId: 1, messageId: 1,
  tool: index % 3 === 0 ? 'web_search' : 'read_url',
  identifier: index % 3 === 0 ? 'web_search' : 'read_url',
  stage: index === 7 ? 'error' as const : 'result' as const, status: index === 7 ? 'error' as const : 'success' as const,
  createdAt: now + index * 1000,
  query: index % 3 === 0 ? 'Figma 免费版与文件协作限制' : 'https://help.figma.com/example-' + index,
  summary: index === 7 ? '页面暂时不可用' : index % 3 === 0 ? '找到 20 条结果' : '已读取网页正文',
  details: { reasoningOffsetStart: Math.min(index * 6, previewReasoning.length), hitsCount: 20 },
  resultText: index === 7 ? undefined : '这是用于开发预览的来源内容，展示完整步骤详情和长文本换行。',
}))

export function previewMeta(key: string, streaming = false): MessageMeta {
  return {
    id: key, sessionId: 1, stableKey: key, role: 'assistant', createdAt: new Date(now).toISOString(),
    reasoningStatus: streaming ? 'streaming' : 'done', reasoningDurationSeconds: 87,
  }
}
