export type SettingsNavItem = {
  key: string
  label: string
  adminOnly?: boolean
  children?: SettingsNavItem[]
}

export const settingsNav: SettingsNavItem[] = [
  {
    key: 'personal',
    label: '个人设置',
    children: [
      { key: 'personal.models', label: '模型配置' },
      { key: 'personal.preferences', label: '偏好设置' },
      { key: 'personal.about', label: '关于' },
    ],
  },
  {
    key: 'system',
    label: '系统设置',
    adminOnly: true,
    children: [
      { key: 'system.general', label: '通用' },
      { key: 'system.network', label: '网络与流式' },
      { key: 'system.models', label: '系统模型' },
      { key: 'system.users', label: '用户管理' },
    ],
  },
]

