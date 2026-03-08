import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus } from 'lucide-react'
import { PlusMenuContent } from '@/components/plus-menu-content'
import { SkillPanelSheet } from '@/components/chat/skill-panel-sheet'
import { useEffect, useState } from 'react'

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
  const [plusAdvancedOpen, setPlusAdvancedOpen] = useState(false)
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    const handle = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handle)
      return () => mq.removeEventListener('change', handle)
    }
    mq.addListener(handle)
    return () => mq.removeListener(handle)
  }, [])

  const openSkillPanelFromMenu = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setSkillPanelOpen(true)
    }, 0)
  }
  const openAdvancedFromQuick = () => {
    setPlusOpen(false)
    window.setTimeout(() => {
      setPlusAdvancedOpen(true)
    }, 0)
  }

  return (
    <>
      {isMobile ? (
        <Popover open={plusOpen} onOpenChange={setPlusOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-muted-foreground transition-colors hover:bg-[hsl(var(--surface-hover))] hover:text-foreground md:h-10 md:w-10 md:rounded-xl"
              disabled={disabled}
              aria-label="更多操作"
            >
              <Plus className="h-[18px] w-[18px]" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={10}
            className="w-[min(92vw,22rem)] rounded-2xl border-border/80 bg-popover/95 p-2 shadow-[0_18px_40px_hsl(var(--background)/0.35)] backdrop-blur-xl"
          >
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
              showAdvancedRequestAction={false}
              showSessionPromptAction={false}
              extraAction={{
                title: '更多设置',
                description: '编辑请求头与会话系统提示词。',
                onClick: openAdvancedFromQuick,
              }}
              container="plain"
              onActionComplete={() => setPlusOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
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
      )}

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

      <Sheet open={plusAdvancedOpen} onOpenChange={setPlusAdvancedOpen}>
        <SheetContent
          side="bottom"
          dialogTitle="更多设置"
          className="rounded-t-3xl border-border/80 bg-card/95 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        >
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-base font-semibold text-foreground">更多设置</h3>
            <p className="mt-1 text-xs text-muted-foreground">低频项单独放置，减少输入区遮挡。</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">
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
              showControlCard={false}
              showCapabilitySummary={false}
              showSkillPanelAction={false}
              onOpenAdvanced={() => {
                setPlusAdvancedOpen(false)
                onOpenAdvanced()
              }}
              onOpenSessionPrompt={() => {
                setPlusAdvancedOpen(false)
                onOpenSessionPrompt()
              }}
              container="plain"
              onActionComplete={() => setPlusAdvancedOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
