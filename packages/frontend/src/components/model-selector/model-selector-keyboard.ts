import type { KeyboardEvent } from 'react'

// Enter/Space remain native button actions, so favorites never activate model selection.
export function handleModelSelectorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.nativeEvent.isComposing) return
  const target = event.target as HTMLElement
  const isSearch = target instanceof HTMLInputElement
  const isModel = target.matches('[data-model-select]')
  const isGroup = target.matches('[data-model-group]')
  if (!isSearch && !isModel && !isGroup) return

  if (isGroup && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    const groups = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-group]'))
    const current = groups.indexOf(target as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + groups.length) % groups.length
    event.preventDefault()
    groups[next]?.focus()
    groups[next]?.click()
    return
  }

  const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-select]'))
  if (!choices.length) return
  if (isSearch && event.key === 'Enter') {
    event.preventDefault()
    choices[0].click()
    return
  }
  const move = ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
  if (!move || (isSearch && !event.key.startsWith('Arrow'))) return
  event.preventDefault()
  const current = choices.indexOf(target as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
    : current < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
  choices[next]?.focus()
  choices[next]?.scrollIntoView({ block: 'nearest' })
}
