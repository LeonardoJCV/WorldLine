import { describe, expect, it } from 'vitest'
import {
  childrenOf,
  chunkCenter,
  chunkExtent,
  cubeDir,
  displaySet,
  faceUV,
  keyOf,
  parentOf,
  parseKey,
  rootKeys,
  selectChunks,
  tileOf,
  type Vec3,
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
    expect(cubeDir(4, 1, 0.25)).toEqual(cubeDir(0, -1, 0.25))
  })
})

describe('selectChunks', () => {
  const base = { maxLevel: 7, focal: 500, error: 60, budget: 320, resolution: 8, minTriangle: 0 }

  it('uses coarse chunks from far away', () => {
    const far = selectChunks({ ...base, camera: [0, 0, 6] })
    const near = selectChunks({ ...base, camera: [0, 0, 1.2] })
    expect(Math.max(...far.map((c) => c.key.level))).toBeLessThanOrEqual(2)
    expect(far.length).toBeLessThan(near.length)
  })

  it('refines under the camera up to the maximum level', () => {
    const chosen = selectChunks({ ...base, maxLevel: 6, camera: [0, 0, 1.01] })
    const deepest = chosen.filter((c) => c.key.level === 6)
    expect(deepest.length).toBeGreaterThan(0)
    for (const c of deepest) expect(chunkCenter(c.key)[2]).toBeGreaterThan(0.9)
    const keys = chosen.map((c) => keyOf(c.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('splits while a chunk edge covers more pixels than the tier allows', () => {
    const coarse = selectChunks({ ...base, error: 400, camera: [0, 0, 1.3] })
    const fine = selectChunks({ ...base, error: 40, camera: [0, 0, 1.3] })
    expect(fine.length).toBeGreaterThan(coarse.length)
    for (const c of coarse) {
      if (c.key.level < base.maxLevel) {
        expect((chunkExtent(c.key) / c.distance) * base.focal).toBeLessThanOrEqual(400)
      }
    }
  })

  it('keeps within the budget by leaving the farthest chunks coarse', () => {
    const camera: Vec3 = [0.2, 0.1, 1.02]
    const free = selectChunks({ ...base, budget: 100_000, camera })
    const capped = selectChunks({ ...base, budget: 60, camera })
    expect(free.length).toBeGreaterThan(60)
    expect(capped.length).toBeLessThanOrEqual(60)
    const nearest = capped.reduce((a, b) => (a.distance < b.distance ? a : b))
    const farthest = capped.reduce((a, b) => (a.distance > b.distance ? a : b))
    expect(nearest.key.level).toBeGreaterThan(farthest.key.level)
  })

  it('keeps every triangle at least the minimum size on screen', () => {
    const camera: Vec3 = [0, 0, 1.01]
    const minTriangle = 8
    const chosen = selectChunks({ ...base, maxLevel: 9, resolution: 32, minTriangle, camera })
    const sharp = selectChunks({ ...base, maxLevel: 9, resolution: 32, camera })
    expect(chosen.length).toBeLessThan(sharp.length)
    for (const c of chosen) {
      const parent = parentOf(c.key)
      if (!parent) continue
      const triangle = (chunkExtent(c.key) / 32 / c.distance) * base.focal
      expect(triangle).toBeGreaterThan(minTriangle * 0.5)
    }
  })

  it('does not refine chunks outside the view', () => {
    const camera: Vec3 = [0, 0, 1.05]
    const all = selectChunks({ ...base, camera })
    const none = selectChunks({ ...base, camera, inView: () => false })
    expect(none.length).toBeLessThan(all.length)
    expect(Math.max(...none.map((c) => c.key.level))).toBe(0)
  })

  it('never returns a chunk together with one of its ancestors', () => {
    const chosen = selectChunks({ ...base, camera: [0.3, 0.2, 1.05] })
    const keys = new Set(chosen.map((c) => keyOf(c.key)))
    for (const c of chosen) {
      let p = parentOf(c.key)
      while (p) {
        expect(keys.has(keyOf(p))).toBe(false)
        p = parentOf(p)
      }
    }
  })
})

describe('faceUV', () => {
  it('inverts cubeDir on every face', () => {
    for (let face = 0; face < 6; face++) {
      for (const [u, v] of [
        [0.3, -0.7],
        [-0.99, 0.5],
        [0, 0],
      ] as const) {
        const back = faceUV(cubeDir(face, u, v))
        expect(back.face).toBe(face)
        expect(back.u).toBeCloseTo(u, 10)
        expect(back.v).toBeCloseTo(v, 10)
      }
    }
  })

  it('finds the tile holding a direction', () => {
    const key = { face: 4, level: 6, x: 40, y: 12 }
    expect(tileOf(chunkCenter(key), 6)).toEqual(key)
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
