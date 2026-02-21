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
      { key: 'system.workspace', label: '配置中心' },
    ],
  },
]
