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

  it('drops the target when the lens returns to the current', () => {
    lensStore.getState().openAt(target)
    lensStore.getState().setLens('current')
    expect(lensStore.getState().lens).toBe('current')
    expect(lensStore.getState().target).toBeNull()
  })

  it('keeps the target while the planet stays open', () => {
    lensStore.getState().openAt(target)
    lensStore.getState().setLens('planet')
    expect(lensStore.getState().target).toEqual(target)
  })

  it('drops the target when the lens moves out to the system', () => {
    lensStore.getState().openAt(target)
    lensStore.getState().setLens('system')
    expect(lensStore.getState().lens).toBe('system')
    expect(lensStore.getState().target).toBeNull()
  })

  it('does not revive a target when returning from the system to the planet', () => {
    lensStore.getState().setLens('system')
    lensStore.getState().setLens('planet')
    expect(lensStore.getState().lens).toBe('planet')
    expect(lensStore.getState().target).toBeNull()
  })
})
