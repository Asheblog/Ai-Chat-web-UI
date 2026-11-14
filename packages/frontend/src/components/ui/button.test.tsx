import { describe, expect, it } from 'vitest'
import { buttonVariants } from './button'

describe('buttonVariants', () => {
  it('supports inverse outline buttons for dark surfaces', () => {
    const classes = buttonVariants({ variant: 'outlineInverse' as never })
    expect(classes).toContain('border-borderStrong')
    expect(classes).toContain('bg-transparent')
    expect(classes).toContain('text-foreground')
    expect(classes).not.toContain('shadow')
  })
})
