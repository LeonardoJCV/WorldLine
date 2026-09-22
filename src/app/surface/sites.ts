import { uniform } from '../../engine/rng.ts'
import { cubeDir, type Vec3 } from './cube.ts'
import { hash3 } from './noise.ts'
import { SEA, type Terrain } from './terrain.ts'

export const MAX_SITES = 48
export const SITE_SPACING = 0.09
export const INFLUENCE = 0.045
export const BUILT_MAX = 0.4
const COS_SPACING = 0.9959527330119943
const GRID = 32
const COAST_STEP = 0.02
const SITE_STRIDE = 6
const CHANNEL = 4096 + 48

export interface Site {
  readonly index: number
  readonly dir: Vec3
  readonly height: number
  readonly coast: boolean
  readonly score: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function findSites(terrain: Terrain): Site[] {
  const salt = Math.floor(uniform(terrain.seed, 0, CHANNEL) * 2147483647)
  const candidates: { dir: Vec3; height: number; coast: boolean; score: number }[] = []
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const cell = face * GRID * GRID + j * GRID + i
        const u = -1 + ((i + 0.2 + 0.6 * hash3(salt, cell, 1, 0)) * 2) / GRID
        const v = -1 + ((j + 0.2 + 0.6 * hash3(salt, cell, 2, 0)) * 2) / GRID
        const dir = cubeDir(face, u, v)
        const s = terrain.sample(dir[0], dir[1], dir[2])
        if (s.biome === 'ocean' || s.biome === 'ice' || s.biome === 'rock') continue
        let coast = false
        for (const [du, dv] of [
          [COAST_STEP, 0],
          [-COAST_STEP, 0],
          [0, COAST_STEP],
          [0, -COAST_STEP],
        ] as const) {
          const n = cubeDir(face, u + du, v + dv)
          if (terrain.sample(n[0], n[1], n[2]).biome === 'ocean') coast = true
        }
        const fertility = clamp01(1 - Math.abs(s.moisture - 0.55) * 2)
        const mild = clamp01(1 - Math.abs(s.temperature - 0.6) * 2)
        const plain = clamp01(1 - (s.height - SEA) * 8)
        const score =
          fertility * 0.35 +
          mild * 0.3 +
          plain * 0.2 +
          (coast ? 0.25 : 0) +
          hash3(salt, cell, 3, 0) * 0.05
        // FIX: arredonda para float32 na criação para que a escolha e o round-trip usem os mesmos números
        candidates.push({
          dir: [Math.fround(dir[0]), Math.fround(dir[1]), Math.fround(dir[2])],
          height: Math.fround(s.height),
          coast,
          score: Math.fround(score),
        })
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const chosen: Site[] = []
  for (const c of candidates) {
    if (chosen.length >= MAX_SITES) break
    const apart = chosen.every(
      (s) => s.dir[0] * c.dir[0] + s.dir[1] * c.dir[1] + s.dir[2] * c.dir[2] <= COS_SPACING,
    )
    if (apart) chosen.push({ index: chosen.length, ...c })
  }
  return chosen
}

export function packSites(sites: readonly Site[]): Float32Array {
  const data = new Float32Array(sites.length * SITE_STRIDE)
  sites.forEach((s, i) => {
    data.set([s.dir[0], s.dir[1], s.dir[2], s.height, s.coast ? 1 : 0, s.score], i * SITE_STRIDE)
  })
  return data
}

export function unpackSites(data: Float32Array): Site[] {
  const sites: Site[] = []
  for (let i = 0; i < data.length; i += SITE_STRIDE) {
    sites.push({
      index: i / SITE_STRIDE,
      dir: [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0],
      height: data[i + 3] ?? 0,
      coast: (data[i + 4] ?? 0) > 0.5,
      score: data[i + 5] ?? 0,
    })
  }
  return sites
}
