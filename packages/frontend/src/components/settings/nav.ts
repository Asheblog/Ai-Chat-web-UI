import { ReactNode } from "react"

export type SettingsNavItem = {
  key: string
  label: string
  icon?: ReactNode
  adminOnly?: boolean
  requiresAuth?: boolean
  children?: SettingsNavItem[]
}

export const settingsNav: SettingsNavItem[] = [
  {
    key: 'personal',
    label: '个人设置',
    children: [
      { key: 'personal.preferences', label: '偏好设置', requiresAuth: true },
      { key: 'personal.security', label: '账号安全', requiresAuth: true },
      { key: 'personal.about', label: '关于' },
    ],
  },
  {
    key: 'system',
    label: '系统设置',
    adminOnly: true,
    requiresAuth: true,
    children: [
      { key: 'system.general', label: '通用' },
      { key: 'system.reasoning', label: '推理链（CoT）' },
      { key: 'system.network', label: '网络与流式' },
      { key: 'system.web-search', label: '联网搜索' },
      { key: 'system.rag', label: 'RAG 文档解析' },
      { key: 'system.knowledge-base', label: '知识库管理' },
      { key: 'system.connections', label: '连接管理' },
      { key: 'system.skills', label: 'Skill 管理' },
      { key: 'system.skill-audits', label: 'Skill 审计日志' },
      { key: 'system.models', label: '模型管理' },
      { key: 'system.model-access', label: '模型权限管理' },
      { key: 'system.logging', label: '日志与监控' },
      { key: 'system.users', label: '用户管理' },
    ],
  },
]
