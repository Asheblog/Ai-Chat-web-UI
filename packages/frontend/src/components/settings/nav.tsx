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

/** 收集顶级项下的全部叶子 key。 */
function collectLeafKeys(items: SettingsNavItem[]): string[] {
  const keys: string[] = []
  for (const item of items) {
    if (!item.children || item.children.length === 0) {
      keys.push(item.key)
    } else {
      keys.push(...collectLeafKeys(item.children))
    }
  }
  return keys
}

/**
 * 解析 select 事件的 key 应切换到的顶级分组与子项。
 * 返回 { main, sub }；key 不在树中时返回 null（宿主忽略该事件）。
 */
export function resolveSelectTarget(
  tree: SettingsNavItem[],
  key: string
): { main: string; sub: string } | null {
  for (const item of tree) {
    if (item.key === key) return { main: item.key, sub: item.key }
    if (!item.children || item.children.length === 0) continue
    if (collectLeafKeys(item.children).includes(key)) {
      return { main: item.key, sub: key }
    }
  }
  return null
}
