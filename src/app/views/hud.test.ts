import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NOTHING_COLLAPSED,
  PANELS,
  isPanel,
  parseCollapsed,
  readCollapsed,
  serializeCollapsed,
  toggleCollapsed,
  writeCollapsed,
} from './hud.ts'

function fakeStorage(seed: Readonly<Record<string, string>> = {}) {
  const entries = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    entries,
  }
}

function blockedStorage() {
  return {
    getItem() {
      throw new Error('storage is blocked')
    },
    setItem() {
      throw new Error('storage is blocked')
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the arrangement starts open', () => {
  it('collapses nothing before the observer asks', () => {
    for (const id of PANELS) expect(NOTHING_COLLAPSED[id]).toBe(false)
  })
})

describe('toggleCollapsed', () => {
  it('folds one panel and leaves the others alone', () => {
    const folded = toggleCollapsed(NOTHING_COLLAPSED, 'events')
    expect(folded.events).toBe(true)
    expect(folded.state).toBe(false)
    expect(NOTHING_COLLAPSED.events).toBe(false)
  })

  it('unfolds the same panel on a second call', () => {
    const folded = toggleCollapsed(NOTHING_COLLAPSED, 'causal')
    expect(toggleCollapsed(folded, 'causal').causal).toBe(false)
  })
})

describe('parseCollapsed', () => {
  it('restores what was written', () => {
    const folded = toggleCollapsed(toggleCollapsed(NOTHING_COLLAPSED, 'worlds'), 'actions')
    expect(parseCollapsed(serializeCollapsed(folded))).toEqual(folded)
  })

  it('reads nothing collapsed from an absent, broken or foreign value', () => {
    expect(parseCollapsed(null)).toEqual(NOTHING_COLLAPSED)
    expect(parseCollapsed('{')).toEqual(NOTHING_COLLAPSED)
    expect(parseCollapsed('"events"')).toEqual(NOTHING_COLLAPSED)
    expect(parseCollapsed('null')).toEqual(NOTHING_COLLAPSED)
  })

  it('keeps the panels it knows and drops the rest of a stored object', () => {
    const restored = parseCollapsed('{"events":true,"ghost":true,"state":"yes","causal":1}')
    expect(restored.events).toBe(true)
    expect(restored.state).toBe(false)
    expect(restored.causal).toBe(false)
    expect(Object.keys(restored).every(isPanel)).toBe(true)
  })
})

describe('storage', () => {
  it('writes and reads the arrangement back', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const folded = toggleCollapsed(NOTHING_COLLAPSED, 'state')
    writeCollapsed(folded)
    expect(readCollapsed()).toEqual(folded)
  })

  it('stays open and silent when storage is unavailable', () => {
    vi.stubGlobal('localStorage', blockedStorage())
    expect(() => writeCollapsed(toggleCollapsed(NOTHING_COLLAPSED, 'state'))).not.toThrow()
    expect(readCollapsed()).toEqual(NOTHING_COLLAPSED)
  })

  it('stays open when there is no storage at all', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => writeCollapsed(NOTHING_COLLAPSED)).not.toThrow()
    expect(readCollapsed()).toEqual(NOTHING_COLLAPSED)
  })
})
