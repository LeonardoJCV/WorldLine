import { describe, expect, it } from 'vitest'
import { planetPalette } from '../planet/uniforms.ts'
import { tileOf } from './cube.ts'
import { OBJECT_KINDS, OBJECT_LEVEL, objectTile } from './objects.ts'
import { findSites, packSites } from './sites.ts'
import { createTerrain } from './terrain.ts'

// FEAT: mudança proposital de sítios ou objetos? copie aqui os valores do erro e justifique no commit
const SITES = 806157810
const TILE = 3606696647

function checksum(parts: readonly Float32Array[]): number {
  let hash = 0x811c9dc5
  for (const part of parts) {
    hash = Math.imul(hash ^ part.length, 0x01000193)
    for (const word of new Uint32Array(part.buffer, part.byteOffset, part.length)) {
      hash = Math.imul(hash ^ word, 0x01000193)
    }
  }
  return hash >>> 0
}

describe('surface fingerprint', () => {
  const terrain = createTerrain(482913, planetPalette(482913))
  const sites = findSites(terrain)

  it('keeps the sites of seed 482913', () => {
    expect(checksum([packSites(sites)])).toBe(SITES)
  })

  it('keeps the objects of the first site tile', () => {
    const home = sites[0]
    if (!home) throw new Error('no site')
    const set = objectTile(terrain, sites, tileOf(home.dir, OBJECT_LEVEL), 1)
    expect(checksum(OBJECT_KINDS.map((kind) => set[kind]))).toBe(TILE)
  })
})
