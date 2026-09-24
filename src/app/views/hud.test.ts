import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NOTHING_COLLAPSED,
  PANELS,
  SHEET_HEIGHTS,
  SHEET_MIN,
  SHEET_STATES,
  clampSheet,
  dragSheet,
  isPanel,
  nextSheet,
  parseCollapsed,
  readCollapsed,
  serializeCollapsed,
  sheetHeight,
  sheetReserve,
  snapSheet,
  toggleCollapsed,
  writeCollapsed,
  type SheetState,
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

describe('the three heights of the sheet', () => {
  it('rises in order and comes back with the handle', () => {
    expect(nextSheet('hidden')).toBe('peek')
    expect(nextSheet('peek')).toBe('open')
    expect(nextSheet('open')).toBe('hidden')
  })

  it('visits every height in one round of the handle', () => {
    const seen: string[] = []
    let state: SheetState = SHEET_STATES[0] ?? 'hidden'
    for (let press = 0; press < SHEET_STATES.length; press++) {
      seen.push(state)
      state = nextSheet(state)
    }
    expect(new Set(seen).size).toBe(SHEET_STATES.length)
    expect(state).toBe(SHEET_STATES[0])
  })

  it('leaves the universe most of the screen when hidden and a strip of it when open', () => {
    expect(SHEET_HEIGHTS.hidden).toBeLessThan(SHEET_HEIGHTS.peek)
    expect(SHEET_HEIGHTS.peek).toBeLessThan(SHEET_HEIGHTS.open)
    expect(SHEET_HEIGHTS.open).toBeLessThan(1)
  })
})

describe('snapSheet', () => {
  it('rests on the height it was released nearest to', () => {
    expect(snapSheet(SHEET_HEIGHTS.hidden)).toBe('hidden')
    expect(snapSheet(SHEET_HEIGHTS.peek)).toBe('peek')
    expect(snapSheet(SHEET_HEIGHTS.open)).toBe('open')
    expect(snapSheet(0.2)).toBe('hidden')
    expect(snapSheet(0.3)).toBe('peek')
    expect(snapSheet(0.58)).toBe('peek')
    expect(snapSheet(0.7)).toBe('open')
  })

  it('rests somewhere even when let go beyond the range', () => {
    expect(snapSheet(-4)).toBe('hidden')
    expect(snapSheet(9)).toBe('open')
    expect(snapSheet(Number.NaN)).toBe('hidden')
  })
})

describe('clampSheet', () => {
  it('never leaves the range, whatever the drag reports', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false }), (fraction) => {
        const height = clampSheet(fraction)
        expect(height).toBeGreaterThanOrEqual(SHEET_HEIGHTS.hidden)
        expect(height).toBeLessThanOrEqual(SHEET_HEIGHTS.open)
      }),
    )
  })

  it('keeps a height that is already inside the range', () => {
    expect(clampSheet(0.5)).toBe(0.5)
  })
})

describe('dragSheet', () => {
  it('never leaves the range in pixels either', () => {
    fc.assert(
      fc.property(
        fc.double({ noDefaultInfinity: false }),
        fc.integer({ min: 0, max: 4000 }),
        (height, available) => {
          const pixels = dragSheet(height, available)
          expect(pixels).toBeGreaterThanOrEqual(sheetHeight('hidden', available))
          expect(pixels).toBeLessThanOrEqual(
            Math.max(sheetHeight('hidden', available), sheetHeight('open', available)),
          )
        },
      ),
    )
  })

  it('follows the pointer between the ends', () => {
    expect(dragSheet(300, 1000)).toBe(300)
  })
})

describe('sheetHeight', () => {
  it('measures each height against the room it has', () => {
    expect(sheetHeight('peek', 1000)).toBe(400)
    expect(sheetHeight('open', 1000)).toBe(850)
  })

  it('keeps the hidden sheet tall enough for the handle and the essentials', () => {
    expect(sheetHeight('hidden', 1000)).toBe(120)
    expect(sheetHeight('hidden', 400)).toBe(SHEET_MIN)
    expect(sheetHeight('hidden', 40)).toBe(40)
  })
})

describe('sheetReserve', () => {
  it('asks the stage for no more room than the peek height', () => {
    expect(sheetReserve('hidden', 1000)).toBe(120)
    expect(sheetReserve('peek', 1000)).toBe(400)
    expect(sheetReserve('open', 1000)).toBe(400)
  })
})
