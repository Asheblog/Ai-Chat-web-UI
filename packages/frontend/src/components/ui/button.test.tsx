import { describe, expect, it } from 'vitest'
import { buttonVariants } from './button'

describe('buttonVariants', () => {
  it('supports inverse outline buttons for dark surfaces', () => {
    const classes = buttonVariants({ variant: 'outlineInverse' as never })

    expect(classes).toContain('bg-slate-950/30')
    expect(classes).toContain('text-slate-100')
    expect(classes).toContain('hover:text-slate-50')
  })
})
