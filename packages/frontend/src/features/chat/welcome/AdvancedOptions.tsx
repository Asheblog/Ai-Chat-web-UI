import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus } from 'lucide-react'
import { PlusMenuContent } from '@/components/plus-menu-content'

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
  onOpenAdvanced,
  onOpenSessionPrompt,
}: AdvancedOptionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full text-muted-foreground"
          disabled={disabled}
          aria-label="更多操作"
        >
          <Plus className="h-5 w-5" />
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
        onOpenAdvanced={onOpenAdvanced}
        onOpenSessionPrompt={onOpenSessionPrompt}
        contentClassName="rounded-2xl"
        bodyClassName="text-sm"
      />
    </DropdownMenu>
  )
}
