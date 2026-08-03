"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SkillInstallSection } from "@/components/settings/pages/system-skills/SkillInstallSection"
import { installSkillFromGithub } from "@/features/skills/api"

/**
 * Skill 安装卡：受控复用 SkillInstallSection，安装 state 与 installSkillFromGithub
 * 逻辑从 SystemSkills 迁入（无 settings key）。
 */
export function SkillInstallCard() {
  const { toast } = useToast()
  const [installSource, setInstallSource] = useState("")
  const [installToken, setInstallToken] = useState("")
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    const source = installSource.trim()
    if (!source) {
      toast({
        title: "请输入仓库地址",
        description: "格式：owner/repo@ref[:subdir] 或 github.com/<owner>/<repo>/(tree|blob)/...",
        variant: "destructive",
      })
      return
    }
    setInstalling(true)
    try {
      const response = await installSkillFromGithub({
        source,
        token: installToken.trim() ? installToken.trim() : undefined,
      })
      if (!response?.success) {
        throw new Error(response?.error || "安装失败")
      }
      toast({
        title: "Skill 安装请求已完成",
        description: "请根据版本状态继续审批或激活",
      })
      setInstallSource("")
      setInstallToken("")
    } catch (error) {
      toast({
        title: "安装失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <FeatureCard
      icon={Download}
      title="Skill 安装"
      description="从 GitHub 仓库安装系统级 Skill"
    >
      <SkillInstallSection
        installSource={installSource}
        installToken={installToken}
        installing={installing}
        onInstallSourceChange={setInstallSource}
        onInstallTokenChange={setInstallToken}
        onInstall={handleInstall}
      />
    </FeatureCard>
  )
}
