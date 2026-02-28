import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, PromptTemplate } from '@/types'

const client = apiHttpClient

export const listPromptTemplates = async (): Promise<PromptTemplate[]> => {
  const response = await client.get<ApiResponse<{ templates: PromptTemplate[] }>>('/prompt-templates')
  if (!response.data.success) {
    throw new Error(response.data.error || '获取提示词模板失败')
  }
  return response.data.data?.templates || []
}

export const createPromptTemplate = async (payload: {
  title: string
  content: string
  variables?: string[]
  pinned?: boolean
}): Promise<PromptTemplate> => {
  const response = await client.post<ApiResponse<PromptTemplate>>('/prompt-templates', payload)
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error || '创建提示词模板失败')
  }
  return response.data.data
}

export const updatePromptTemplate = async (
  templateId: number,
  payload: {
    title?: string
    content?: string
    variables?: string[]
    pinned?: boolean
  },
): Promise<PromptTemplate> => {
  const response = await client.put<ApiResponse<PromptTemplate>>(`/prompt-templates/${templateId}`, payload)
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error || '更新提示词模板失败')
  }
  return response.data.data
}

export const deletePromptTemplate = async (templateId: number): Promise<void> => {
  const response = await client.delete<ApiResponse>(`/prompt-templates/${templateId}`)
  if (!response.data.success) {
    throw new Error(response.data.error || '删除提示词模板失败')
  }
}
