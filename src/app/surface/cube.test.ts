import { describe, expect, it } from 'vitest'
import {
  childrenOf,
  chunkCenter,
  cubeDir,
  displaySet,
  keyOf,
  parentOf,
  parseKey,
  rootKeys,
  selectChunks,
} from './cube.ts'

describe('keys', () => {
  it('round-trips and walks the tree', () => {
    const key = { face: 4, level: 3, x: 5, y: 2 }
    expect(parseKey(keyOf(key))).toEqual(key)
    expect(parentOf(key)).toEqual({ face: 4, level: 2, x: 2, y: 1 })
    expect(childrenOf(key).map((k) => parentOf(k))).toEqual(new Array(4).fill(key))
    expect(parentOf(rootKeys()[0] ?? key)).toBeNull()
    expect(rootKeys()).toHaveLength(6)
  })
})

describe('cubeDir', () => {
  it('maps every face onto the unit sphere and shares face edges', () => {
    for (let face = 0; face < 6; face++) {
      const d = cubeDir(face, 0.3, -0.7)
      expect(Math.hypot(...d)).toBeCloseTo(1, 12)
    }
    expect(cubeDir(4, 0, 0)).toEqual([0, 0, 1])
  })
})

describe('selectChunks', () => {
  it('uses coarse chunks from far away', () => {
    const chosen = selectChunks({ camera: [0, 0, 6], maxLevel: 7, split: 2 })
    expect(Math.max(...chosen.map((k) => k.level))).toBeLessThanOrEqual(1)
    expect(chosen.length).toBeLessThanOrEqual(24)
  })

  it('refines under the camera up to the maximum level', () => {
    const chosen = selectChunks({ camera: [0, 0, 1.01], maxLevel: 6, split: 2 })
    const deepest = chosen.filter((k) => k.level === 6)
    expect(deepest.length).toBeGreaterThan(0)
    for (const k of deepest) expect(chunkCenter(k)[2]).toBeGreaterThan(0.9)
    const keys = chosen.map(keyOf)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never returns a chunk together with one of its ancestors', () => {
    const chosen = selectChunks({ camera: [0.3, 0.2, 1.05], maxLevel: 7, split: 2 })
    const keys = new Set(chosen.map(keyOf))
    for (const k of chosen) {
      let p = parentOf(k)
      while (p) {
        expect(keys.has(keyOf(p))).toBe(false)
        p = parentOf(p)
      }
    }
  })
})

describe('displaySet', () => {
  it('falls back to the nearest loaded ancestor without overlapping', () => {
    const root = { face: 4, level: 0, x: 0, y: 0 }
    const [a, b] = childrenOf(root)
    const wanted = [keyOf(a ?? root), keyOf(b ?? root)]
    expect(displaySet(wanted, new Set([keyOf(root), keyOf(a ?? root)]))).toEqual([keyOf(root)])
    expect(displaySet(wanted, new Set([keyOf(root), ...wanted])).sort()).toEqual([...wanted].sort())
  })
})
