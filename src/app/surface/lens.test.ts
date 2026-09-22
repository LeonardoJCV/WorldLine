import { afterEach, describe, expect, it } from 'vitest'
import { lensStore, type LensTarget } from './lens.ts'

const target: LensTarget = { dir: [0, 1, 0], year: 1724, site: 3, kind: 'fire' }

afterEach(() => lensStore.setState({ lens: 'current', target: null }))

describe('lensStore', () => {
  it('opens the planet at a target', () => {
    lensStore.getState().openAt(target)
    expect(lensStore.getState().lens).toBe('planet')
    expect(lensStore.getState().target).toEqual(target)
  })

  it('clears only the target', () => {
    lensStore.getState().openAt(target)
    lensStore.getState().clearTarget()
    expect(lensStore.getState().lens).toBe('planet')
    expect(lensStore.getState().target).toBeNull()
  })
})
