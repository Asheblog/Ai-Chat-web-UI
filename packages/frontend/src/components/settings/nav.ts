export type SettingsNavItem = {
  key: string
  label: string
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
      { key: 'system.connections', label: '连接管理' },
      { key: 'system.models', label: '模型管理' },
      { key: 'system.users', label: '用户管理' },
    ],
  },
]
