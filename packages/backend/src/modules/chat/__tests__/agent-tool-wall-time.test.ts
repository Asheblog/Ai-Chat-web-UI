import { createToolWallTimer } from '../agent-tool-wall-time'

describe('agent tool wall time', () => {
  it('counts overlapping calls once and excludes idle gaps between rounds', () => {
    let now = 10
    const timer = createToolWallTimer(() => now)
    const finishA = timer.start()
    now = 20
    const finishB = timer.start()
    now = 30
    finishA()
    now = 40
    finishB()
    now = 80
    const finishC = timer.start()
    now = 100
    finishC()
    expect(timer.elapsedMs()).toBe(50)
  })

  it('counts no time before any tool starts', () => {
    const timer = createToolWallTimer(() => 500)
    expect(timer.elapsedMs()).toBe(0)
  })
})
