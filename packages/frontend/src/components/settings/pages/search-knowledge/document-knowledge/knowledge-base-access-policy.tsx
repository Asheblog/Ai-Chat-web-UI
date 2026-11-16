"use client"

import { Switch } from "@/components/ui/switch"
import { SettingRow } from "@/components/settings/components/setting-row"

export interface KnowledgeBaseAccessPolicyProps {
  allowAnonymous: boolean
  allowUsers: boolean
  onAllowAnonymousChange: (value: boolean) => void
  onAllowUsersChange: (value: boolean) => void
}

/**
 * 知识库访问策略：服务端按同一组开关校验列表、详情与检索接口，
 * 关闭后直接构造请求也拿不到内容；管理面（建库、上传、删除）不受角色开关影响。
 */
export function KnowledgeBaseAccessPolicy({
  allowAnonymous,
  allowUsers,
  onAllowAnonymousChange,
  onAllowUsersChange,
}: KnowledgeBaseAccessPolicyProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold leading-6 text-foreground">谁可以使用知识库</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
          这是服务端校验的访问策略：关掉后对应身份在聊天里拿不到知识库内容，管理员仍可在本页维护知识库。
        </p>
      </div>
      <SettingRow title="允许匿名用户使用" description="未登录用户是否可以在聊天中选择知识库。">
        {(descriptionId) => (
          <Switch
            aria-label="允许匿名用户使用"
            aria-describedby={descriptionId}
            checked={allowAnonymous}
            onCheckedChange={(value) => onAllowAnonymousChange(Boolean(value))}
          />
        )}
      </SettingRow>
      <SettingRow title="允许注册用户使用" description="已登录用户是否可以在聊天中选择知识库。">
        {(descriptionId) => (
          <Switch
            aria-label="允许注册用户使用"
            aria-describedby={descriptionId}
            checked={allowUsers}
            onCheckedChange={(value) => onAllowUsersChange(Boolean(value))}
          />
        )}
      </SettingRow>
    </div>
  )
}
