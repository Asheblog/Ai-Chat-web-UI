import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ getMessageProgress: vi.fn(), getMessageByClientId: vi.fn() }))
vi.mock('@/features/chat/api/messages', () => api)
import { useProcessDetail } from '../use-process-detail'
const meta = {id:12,sessionId:7,role:'assistant' as const,createdAt:'2026-11-14',stableKey:'message-12'}
beforeEach(() => {vi.clearAllMocks()})
describe('process history detail', () => {
 it('loads exact-message full projection only when requested', async () => {
  api.getMessageProgress.mockResolvedValue({success:true,data:{message:{...meta,content:'真实回答',toolEvents:[{id:'event',tool:'read_url',stage:'result',createdAt:1}]}}})
  const {result}=renderHook(() => useProcessDetail(meta, true))
  expect(api.getMessageProgress).not.toHaveBeenCalled()
  await act(async () => {await result.current.load()})
  expect(api.getMessageProgress).toHaveBeenCalledWith(7,12)
  expect(result.current.message?.toolEvents?.[0].id).toBe('event')
 })
 it('does not publish stale details after switching messages', async () => {
  let finish: (value:unknown)=>void = () => {}
  api.getMessageProgress.mockReturnValue(new Promise(resolve=>{finish=resolve}))
  const {result,rerender}=renderHook(({id})=>useProcessDetail({...meta,id},true),{initialProps:{id:12}})
  act(()=>{void result.current.load()})
  rerender({id:13})
  await act(async()=>{finish({success:true,data:{message:{...meta,content:'旧消息'}}})})
  expect(result.current.message).toBeUndefined()
 })
 it('keeps failures visible and permits an explicit retry', async () => {
  api.getMessageProgress.mockRejectedValueOnce(new Error('详情读取失败')).mockResolvedValueOnce({success:true,data:{message:meta}})
  const {result}=renderHook(()=>useProcessDetail(meta,true))
  await act(async()=>{await result.current.load()})
  expect(result.current.error).toBe('详情读取失败')
  await act(async()=>{await result.current.load()})
  await waitFor(()=>expect(result.current.message?.id).toBe(12))
 })
})
