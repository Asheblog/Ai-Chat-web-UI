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
      { key: 'personal.connections', label: '直连连接' },
      { key: 'personal.preferences', label: '偏好设置' },
      { key: 'personal.security', label: '账号安全' },
      { key: 'personal.about', label: '关于' },
    ],
  },
  {
    key: 'system',
    label: '系统设置',
    adminOnly: true,
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
