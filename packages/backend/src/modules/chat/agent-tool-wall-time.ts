import { performance } from 'node:perf_hooks'

/** Measures the union of the intervals occupied by tools in one response. */
export function createToolWallTimer(now = () => performance.now()) {
  let active = 0
  let startedAt = 0
  let occupiedMs = 0

  return {
    start() {
      if (active++ === 0) startedAt = now()
      return () => {
        if (--active === 0) occupiedMs += now() - startedAt
      }
    },
    elapsedMs() {
      return Math.round(occupiedMs + (active > 0 ? now() - startedAt : 0))
    },
  }
}
