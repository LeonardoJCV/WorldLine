import { describe, expect, it } from 'vitest'
import { currentKey } from './keys.ts'

const state = { present: 100, cursor: null, view: null }

describe('currentKey', () => {
  it('moves the cursor by one year or ten with shift', () => {
    expect(currentKey('ArrowLeft', false, state)).toEqual({ cursor: 99 })
    expect(currentKey('ArrowLeft', true, { ...state, cursor: 50 })).toEqual({ cursor: 40 })
    expect(currentKey('Home', false, state)).toEqual({ cursor: 0 })
    expect(currentKey('Escape', false, { ...state, cursor: 5 })).toEqual({ cursor: null })
  })

  it('zooms and resets the view', () => {
    expect(currentKey('+', false, state)).toHaveProperty('view')
    expect(currentKey('0', false, state)).toEqual({ view: null })
  })

  it('ignores other keys', () => {
    expect(currentKey('a', false, state)).toBeNull()
  })
})
