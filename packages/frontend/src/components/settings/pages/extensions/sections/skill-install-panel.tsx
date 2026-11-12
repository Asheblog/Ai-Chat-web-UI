"use client"

import { useState } from "react"
import { SkillInstallSection } from "@/components/settings/pages/system-skills/SkillInstallSection"
import { useToast } from "@/components/ui/use-toast"
import { installSkillFromGithub } from "@/features/skills/api"

/**
 * Skill 安装面板：安装 state 与 installSkillFromGithub 调用从原 `SkillInstallCard` 迁入，
 * 去掉 FeatureCard 外壳后直接渲染既有 `SkillInstallSection`（校验、payload、按钮态都没改）。
 */
export function SkillInstallPanel(): JSX.Element {
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
      if (!response?.success) throw new Error(response?.error || "安装失败")
      toast({
        title: "Skill 安装请求已完成",
        description: "已提交安装，去「待审批」或「版本」继续",
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
    <SkillInstallSection
      installSource={installSource}
      installToken={installToken}
      installing={installing}
      onInstallSourceChange={setInstallSource}
      onInstallTokenChange={setInstallToken}
      onInstall={handleInstall}
    />
  )
}
