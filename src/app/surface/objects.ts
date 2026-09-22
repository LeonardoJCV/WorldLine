import {
  chunkCorner,
  cubeDir,
  keyOf,
  tangentFrame,
  tileOf,
  type ChunkKey,
  type Vec3,
} from './cube.ts'
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
const PER_TILE = { trees: 1400, animals: 150 } as const
const PER_SITE = { buildings: 900, fields: 700, boats: 60, factories: 32, mines: 16 } as const
const RING = {
  buildings: [0, BUILT_MAX],
  fields: [0.12, 1],
  boats: [0.25, 1],
  factories: [0.18, 0.55],
  mines: [0.3, 1],
} as const
export const SINK = 0.0002
const TAU = 6.283185307179586

// FIX: hash3 correlaciona coordenadas vizinhas (fileiras e centro vazio); mistura mais forte para espalhar
export function scatter(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul(seed ^ 0x27d4eb2f, 0x9e3779b1)
  h = Math.imul(h ^ (a | 0) ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (b | 0) ^ (h >>> 13), 0xc2b2ae35)
  h = Math.imul(h ^ (c | 0) ^ (h >>> 16), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

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
      u0 + size * scatter(salt, tileSeed, i, 1),
      v0 + size * scatter(salt, tileSeed, i, 2),
    )
    const s = terrain.sample(dir[0], dir[1], dir[2])
    const keep =
      s.biome === 'forest' ||
      (s.biome === 'grassland' && scatter(salt, tileSeed, i, 3) < 0.22) ||
      (s.biome === 'tundra' && scatter(salt, tileSeed, i, 3) < 0.08)
    if (!keep) continue
    const r = surfaceRadius(s.height) - SINK
    const near = nearestSite(sites, dir)
    out.trees.push(
      dir[0] * r,
      dir[1] * r,
      dir[2] * r,
      scatter(salt, tileSeed, i, 4) * TAU,
      0.8 + scatter(salt, tileSeed, i, 5) * 0.5,
      scatter(salt, tileSeed, i, 6),
      near.index,
      near.ring,
    )
  }
  for (let i = 0; i < naturalCount(PER_TILE.animals); i++) {
    const dir = cubeDir(
      key.face,
      u0 + size * scatter(salt, tileSeed, i, 11),
      v0 + size * scatter(salt, tileSeed, i, 12),
    )
    const s = terrain.sample(dir[0], dir[1], dir[2])
    if (s.biome !== 'grassland' && s.biome !== 'tundra' && s.biome !== 'forest') continue
    const r = surfaceRadius(s.height) - SINK
    const near = nearestSite(sites, dir)
    out.animals.push(
      dir[0] * r,
      dir[1] * r,
      dir[2] * r,
      scatter(salt, tileSeed, i, 13) * TAU,
      0.9 + scatter(salt, tileSeed, i, 14) * 0.3,
      scatter(salt, tileSeed, i, 15),
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
    const [east, north] = tangentFrame(site.dir)
    for (const kind of ['buildings', 'fields', 'boats', 'factories', 'mines'] as const) {
      const [inner, outer] = RING[kind]
      const count = Math.round(PER_SITE[kind] * density)
      const kindSalt = OBJECT_KINDS.indexOf(kind) * 7919
      for (let i = 0; i < count; i++) {
        const sx = scatter(salt, site.index, kindSalt + i, 21) * 2 - 1
        const sy = scatter(salt, site.index, kindSalt + i, 22) * 2 - 1
        const spread = Math.sqrt(sx * sx + sy * sy)
        if (spread > 1) continue
        // FEAT: adensa os candidatos perto do centro, onde cidades pequenas e lavouras aparecem
        const pull = Math.sqrt(spread)
        const dx = sx * pull
        const dy = sy * pull
        const ring = spread * pull
        if (ring * outer < inner) continue
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
          scatter(salt, site.index, kindSalt + i, 23) > 0.3
        )
          continue
        const r = kind === 'boats' ? 1 : surfaceRadius(s.height) - SINK
        out[kind].push(
          dir[0] * r,
          dir[1] * r,
          dir[2] * r,
          scatter(salt, site.index, kindSalt + i, 24) * TAU,
          kind === 'fields' ? 0.8 + scatter(salt, site.index, kindSalt + i, 25) * 0.5 : 1,
          scatter(salt, site.index, kindSalt + i, 26),
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
