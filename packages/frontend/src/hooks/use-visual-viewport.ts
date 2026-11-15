'use client'

import { useEffect } from 'react'

/** Share the visible viewport with the chat shell and its portalled mobile sheets. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const style = document.documentElement.style
    const names = ['--app-visible-height', '--app-viewport-offset-top', '--app-keyboard-inset']
    const previous = names.map((name) => style.getPropertyValue(name))
    const update = () => {
      // Keep pinch zoom independent of application layout and text reflow.
      if (viewport && viewport.scale !== 1) return
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      style.setProperty(names[0], height + 'px')
      style.setProperty(names[1], top + 'px')
      style.setProperty(names[2], Math.max(0, window.innerHeight - height - top) + 'px')
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      names.forEach((name, index) => {
        if (previous[index]) style.setProperty(name, previous[index])
        else style.removeProperty(name)
      })
    }
  }, [])
}
