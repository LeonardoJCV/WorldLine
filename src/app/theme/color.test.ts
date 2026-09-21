import { describe, expect, it } from 'vitest'
import { hexToRgb, mixRgb, rgba, withAlpha } from './color.ts'

describe('color helpers', () => {
  it('parses hex colors into unit rgb', () => {
    expect(hexToRgb('#ff0080')).toEqual([1, 0, 128 / 255])
  })

  it('mixes linearly', () => {
    expect(mixRgb([0, 0, 0], [1, 0.5, 0.2], 0.5)).toEqual([0.5, 0.25, 0.1])
  })

  it('writes css rgba strings', () => {
    expect(rgba([1, 0.5, 0], 0.25)).toBe('rgba(255, 128, 0, 0.25)')
    expect(withAlpha('#3574d8', 0.5)).toBe('rgba(53, 116, 216, 0.5)')
  })
})
