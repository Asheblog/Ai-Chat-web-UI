import { ReactNode } from "react"
import { systemSettingsTree } from "./system-settings-registry"
import type { LucideIcon } from "lucide-react"

export type SettingsNavItem = {
  key: string
  label: string
  icon?: ReactNode
  adminOnly?: boolean
  requiresAuth?: boolean
  children?: SettingsNavItem[]
}

/** Convert LucideIcon to a settings-nav-friendly ReactNode */
function iconNode(Icon: LucideIcon): ReactNode {
  const IconComponent = Icon as React.ComponentType<{ className?: string }>
  return <IconComponent className="h-[1.125rem] w-[1.125rem]" />
}

/** Build system children from the shared registry tree (top-level leaves + workspace groups) */
function buildSystemChildren(): SettingsNavItem[] {
  return systemSettingsTree.map((entry) => {
    if ("children" in entry) {
      return {
        key: entry.key,
        label: entry.label,
        icon: iconNode(entry.icon),
        children: entry.children.map((leaf) => ({
          key: leaf.key,
          label: leaf.label,
          icon: iconNode(leaf.icon),
        })),
      }
    }
    return {
      key: entry.key,
      label: entry.label,
      icon: iconNode(entry.icon),
    }
  })
}

export const settingsNav: SettingsNavItem[] = [
  {
    key: 'personal',
    label: '个人设置',
    children: [
      { key: 'personal.preferences', label: '偏好设置', requiresAuth: true },
      { key: 'personal.skills', label: '个人 Skills', requiresAuth: true },
      { key: 'personal.shares', label: '分享管理', requiresAuth: true },
      { key: 'personal.security', label: '账号安全', requiresAuth: true },
      { key: 'personal.about', label: '关于' },
    ],
  },
  {
    key: 'system',
    label: '系统设置',
    adminOnly: true,
    requiresAuth: true,
    children: buildSystemChildren(),
  },
]
