import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarSessionSearch } from '@/components/sidebar-session-search'

describe('SidebarSessionSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('连续输入只在停顿后提交一次过滤条件', () => {
    const onChange = vi.fn()
    render(<SidebarSessionSearch onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: '搜索会话' })

    fireEvent.change(input, { target: { value: '会' } })
    fireEvent.change(input, { target: { value: '会话' } })
    fireEvent.change(input, { target: { value: '会话 标题' } })
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('会话 标题')
  })

  it('清空输入会提交空过滤条件', () => {
    const onChange = vi.fn()
    render(<SidebarSessionSearch onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: '搜索会话' })

    fireEvent.change(input, { target: { value: 'abc' } })
    act(() => {
      vi.advanceTimersByTime(160)
    })
    fireEvent.change(input, { target: { value: '' } })
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(onChange).toHaveBeenLastCalledWith('')
  })
})
