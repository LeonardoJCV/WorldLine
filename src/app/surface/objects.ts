import { chunkCorner, cubeDir, keyOf, tileOf, type ChunkKey, type Vec3 } from './cube.ts'
import { hash3 } from './noise.ts'
import { BUILT_MAX, INFLUENCE, type Site } from './sites.ts'
import { surfaceRadius, type Terrain } from './terrain.ts'

export const OBJECT_LEVEL = 6
export const STRIDE = 8
export const OBJECT_KINDS = [
  'trees',
  'buildings',
  'fields',
  'animals',
  'boats',
  'factories',
  'mines',
] as const
export type ObjectKind = (typeof OBJECT_KINDS)[number]
export type ObjectSet = Record<ObjectKind, Float32Array>

export const DENSITY = { low: 0.35, high: 1, ultra: 2.4 } as const
const PER_TILE = { trees: 700, animals: 90 } as const
const PER_SITE = { buildings: 420, fields: 260, boats: 40, factories: 24, mines: 16 } as const
const RING = {
  buildings: [0, BUILT_MAX],
  fields: [0.12, 1],
  boats: [0.25, 1],
  factories: [0.18, 0.55],
  mines: [0.3, 1],
} as const
const SINK = 0.0002
const TAU = 6.283185307179586

function nearestSite(sites: readonly Site[], dir: Vec3): { index: number; ring: number } {
  let best = -1
  let bestDot = -2
  for (const site of sites) {
    const dot = site.dir[0] * dir[0] + site.dir[1] * dir[1] + site.dir[2] * dir[2]
    if (dot > bestDot) {
      bestDot = dot
      best = site.index
    }
  }
  const angle = Math.sqrt(Math.max(0, 2 - 2 * bestDot))
  return { index: best, ring: Math.min(4, angle / INFLUENCE) }
}

function frame(dir: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0]
  const ex = ref[1] * dir[2] - ref[2] * dir[1]
  const ey = ref[2] * dir[0] - ref[0] * dir[2]
  const ez = ref[0] * dir[1] - ref[1] * dir[0]
  const el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1
  const east: Vec3 = [ex / el, ey / el, ez / el]
  const north: Vec3 = [
    dir[1] * east[2] - dir[2] * east[1],
    dir[2] * east[0] - dir[0] * east[2],
    dir[0] * east[1] - dir[1] * east[0],
  ]
  return [east, north]
}

export function objectTile(
  terrain: Terrain,
  sites: readonly Site[],
  key: ChunkKey,
  density: number,
): ObjectSet {
  const out: Record<ObjectKind, number[]> = {
    trees: [],
    buildings: [],
    fields: [],
    animals: [],
    boats: [],
    factories: [],
    mines: [],
  }
  const tileKey = keyOf(key)
  const salt = terrain.seed ^ 0x2c1b3c6d
  const { u0, v0, size } = chunkCorner(key)
  const tileSeed = key.face * 1_000_003 + key.x * 4099 + key.y

  const naturalCount = (base: number) => Math.round(base * density)
  for (let i = 0; i < naturalCount(PER_TILE.trees); i++) {
    const dir = cubeDir(
      key.face,
      u0 + size * hash3(salt, tileSeed, i, 1),
      v0 + size * hash3(salt, tileSeed, i, 2),
    )
    const s = terrain.sample(dir[0], dir[1], dir[2])
    const keep =
      s.biome === 'forest' ||
      (s.biome === 'grassland' && hash3(salt, tileSeed, i, 3) < 0.22) ||
      (s.biome === 'tundra' && hash3(salt, tileSeed, i, 3) < 0.08)
    if (!keep) continue
    const r = surfaceRadius(s.height) - SINK
    const near = nearestSite(sites, dir)
    out.trees.push(
      dir[0] * r,
      dir[1] * r,
      dir[2] * r,
      hash3(salt, tileSeed, i, 4) * TAU,
      0.8 + hash3(salt, tileSeed, i, 5) * 0.5,
      hash3(salt, tileSeed, i, 6),
      near.index,
      near.ring,
    )
  }
  for (let i = 0; i < naturalCount(PER_TILE.animals); i++) {
    const dir = cubeDir(
      key.face,
      u0 + size * hash3(salt, tileSeed, i, 11),
      v0 + size * hash3(salt, tileSeed, i, 12),
    )
    const s = terrain.sample(dir[0], dir[1], dir[2])
    if (s.biome !== 'grassland' && s.biome !== 'tundra' && s.biome !== 'forest') continue
    const r = surfaceRadius(s.height) - SINK
    const near = nearestSite(sites, dir)
    out.animals.push(
      dir[0] * r,
      dir[1] * r,
      dir[2] * r,
      hash3(salt, tileSeed, i, 13) * TAU,
      0.9 + hash3(salt, tileSeed, i, 14) * 0.3,
      hash3(salt, tileSeed, i, 15),
      near.index,
      near.ring,
    )
  }

  const tileCenter = cubeDir(key.face, u0 + size / 2, v0 + size / 2)
  const reach = size * 0.8 + INFLUENCE
  const cosReach = 1 - (reach * reach) / 2
  for (const site of sites) {
    const dot =
      site.dir[0] * tileCenter[0] + site.dir[1] * tileCenter[1] + site.dir[2] * tileCenter[2]
    if (dot < cosReach) continue
    const [east, north] = frame(site.dir)
    for (const kind of ['buildings', 'fields', 'boats', 'factories', 'mines'] as const) {
      const [inner, outer] = RING[kind]
      const count = Math.round(PER_SITE[kind] * density)
      const kindSalt = OBJECT_KINDS.indexOf(kind) * 7919
      for (let i = 0; i < count; i++) {
        const dx = hash3(salt, site.index, kindSalt + i, 21) * 2 - 1
        const dy = hash3(salt, site.index, kindSalt + i, 22) * 2 - 1
        const ring = Math.sqrt(dx * dx + dy * dy)
        if (ring > 1 || ring * outer < inner) continue
        const reachOut = INFLUENCE * outer
        const px = site.dir[0] + (east[0] * dx + north[0] * dy) * reachOut
        const py = site.dir[1] + (east[1] * dx + north[1] * dy) * reachOut
        const pz = site.dir[2] + (east[2] * dx + north[2] * dy) * reachOut
        const pl = Math.sqrt(px * px + py * py + pz * pz)
        const dir: Vec3 = [px / pl, py / pl, pz / pl]
        if (keyOf(tileOf(dir, OBJECT_LEVEL)) !== tileKey) continue
        const s = terrain.sample(dir[0], dir[1], dir[2])
        const water = s.biome === 'ocean'
        if (kind === 'boats' ? !water : water || s.biome === 'ice') continue
        if (kind === 'fields' && s.biome === 'rock') continue
        if (
          kind === 'mines' &&
          s.biome !== 'rock' &&
          s.biome !== 'tundra' &&
          hash3(salt, site.index, kindSalt + i, 23) > 0.3
        )
          continue
        const r = kind === 'boats' ? 1 : surfaceRadius(s.height) - SINK
        out[kind].push(
          dir[0] * r,
          dir[1] * r,
          dir[2] * r,
          hash3(salt, site.index, kindSalt + i, 24) * TAU,
          kind === 'fields' ? 0.8 + hash3(salt, site.index, kindSalt + i, 25) * 0.5 : 1,
          hash3(salt, site.index, kindSalt + i, 26),
          site.index,
          ring * outer,
        )
      }
    }
  }
  const result = {} as Record<ObjectKind, Float32Array>
  for (const kind of OBJECT_KINDS) result[kind] = new Float32Array(out[kind])
  return result
}
