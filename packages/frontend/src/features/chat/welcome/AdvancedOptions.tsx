import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus } from 'lucide-react'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { SkillPanelSheet } from '@/components/chat/skill-panel-sheet'
import { useState } from 'react'

interface AdvancedOptionsProps {
  disabled: boolean
  thinkingEnabled: boolean
  onToggleThinking: (value: boolean) => void
  effort: 'unset' | 'low' | 'medium' | 'high'
  onEffortChange: (value: 'unset' | 'low' | 'medium' | 'high') => void
  webSearchEnabled: boolean
  onToggleWebSearch: (value: boolean) => void
  canUseWebSearch: boolean
  showWebSearchScope: boolean
  webSearchScope: string
  onWebSearchScopeChange: (value: string) => void
  webSearchDisabledNote?: string
  pythonToolEnabled: boolean
  onTogglePythonTool: (value: boolean) => void
  canUsePythonTool: boolean
  pythonToolDisabledNote?: string
  skillOptions: Array<{
    slug: string
    label: string
    description?: string
    enabled: boolean
  }>
  onToggleSkillOption: (slug: string, enabled: boolean) => void
  onOpenAdvanced: () => void
  onOpenSessionPrompt: () => void
}

export function AdvancedOptions({
  disabled,
  thinkingEnabled,
  onToggleThinking,
  effort,
  onEffortChange,
  webSearchEnabled,
  onToggleWebSearch,
  canUseWebSearch,
  showWebSearchScope,
  webSearchScope,
  onWebSearchScopeChange,
  webSearchDisabledNote,
  pythonToolEnabled,
  onTogglePythonTool,
  canUsePythonTool,
  pythonToolDisabledNote,
  skillOptions,
  onToggleSkillOption,
  onOpenAdvanced,
  onOpenSessionPrompt,
}: AdvancedOptionsProps) {
  const [plusOpen, setPlusOpen] = useState(false)
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const openSkillPanelFromMenu = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setSkillPanelOpen(true)
    }, 0)
  }

  return (
    <>
      <DropdownMenu open={plusOpen} onOpenChange={setPlusOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl text-muted-foreground transition-colors hover:bg-[hsl(var(--surface-hover))] hover:text-foreground"
            disabled={disabled}
            aria-label="更多操作"
          >
            <Plus className="h-[18px] w-[18px]" />
          </Button>
        </DropdownMenuTrigger>
        <PlusMenuContent
          thinkingEnabled={thinkingEnabled}
          onToggleThinking={onToggleThinking}
          effort={effort}
          onEffortChange={onEffortChange}
          webSearchEnabled={webSearchEnabled}
          onToggleWebSearch={onToggleWebSearch}
          canUseWebSearch={canUseWebSearch}
          showWebSearchScope={showWebSearchScope}
          webSearchScope={webSearchScope}
          onWebSearchScopeChange={onWebSearchScopeChange}
          webSearchDisabledNote={webSearchDisabledNote}
          pythonToolEnabled={pythonToolEnabled}
          onTogglePythonTool={onTogglePythonTool}
          canUsePythonTool={canUsePythonTool}
          pythonToolDisabledNote={pythonToolDisabledNote}
          skillOptions={skillOptions}
          onToggleSkillOption={onToggleSkillOption}
          onOpenSkillPanel={openSkillPanelFromMenu}
          onOpenAdvanced={() => {
            setPlusOpen(false)
            onOpenAdvanced()
          }}
          onOpenSessionPrompt={() => {
            setPlusOpen(false)
            onOpenSessionPrompt()
          }}
          contentClassName="rounded-2xl"
          bodyClassName="text-sm"
          onActionComplete={() => setPlusOpen(false)}
        />
      </DropdownMenu>

      <SkillPanelSheet
        open={skillPanelOpen}
        onOpenChange={setSkillPanelOpen}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={onToggleWebSearch}
        canUseWebSearch={canUseWebSearch}
        showWebSearchScope={showWebSearchScope}
        webSearchScope={webSearchScope}
        onWebSearchScopeChange={onWebSearchScopeChange}
        webSearchDisabledNote={webSearchDisabledNote}
        pythonToolEnabled={pythonToolEnabled}
        onTogglePythonTool={onTogglePythonTool}
        canUsePythonTool={canUsePythonTool}
        pythonToolDisabledNote={pythonToolDisabledNote}
        skillOptions={skillOptions}
        onToggleSkillOption={onToggleSkillOption}
      />
    </>
  )
}
