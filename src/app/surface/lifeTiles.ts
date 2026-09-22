import { tangentFrame, tileOf, keyOf, type Vec3 } from './cube.ts'
import { OBJECT_LEVEL } from './objects.ts'

export const LIFE_FROM = 0.45
export const TILE_BUDGET = { low: 24, high: 90, ultra: 160 } as const
const REACH_MAX = 0.4
const REACH_RATE = 2.2
const STEP = 0.008

export interface LifeArea {
  readonly keys: string[]
  readonly reach: number
}

export function lifeReach(altitude: number): number {
  if (altitude >= LIFE_FROM) return 0
  return Math.min(REACH_MAX, altitude * REACH_RATE + 0.01)
}

const offsets = new Map<number, { x: number; y: number; gap: number }[]>()

function ring(cells: number): { x: number; y: number; gap: number }[] {
  const known = offsets.get(cells)
  if (known) return known
  const list: { x: number; y: number; gap: number }[] = []
  for (let j = -cells; j <= cells; j++) {
    for (let i = -cells; i <= cells; i++) {
      const x = i * STEP
      const y = j * STEP
      list.push({ x, y, gap: Math.sqrt(x * x + y * y) })
    }
  }
  list.sort((a, b) => a.gap - b.gap)
  offsets.set(cells, list)
  return list
}

export function wantedTiles(dir: Vec3, altitude: number, budget: number): LifeArea {
  const target = lifeReach(altitude)
  if (target <= 0 || budget <= 0) return { keys: [], reach: 0 }
  const [east, north] = tangentFrame(dir)
  const keys: string[] = []
  const seen = new Set<string>()
  for (const { x, y, gap } of ring(Math.ceil(target / STEP))) {
    if (gap > target) break
    const p: Vec3 = [
      dir[0] + east[0] * x + north[0] * y,
      dir[1] + east[1] * x + north[1] * y,
      dir[2] + east[2] * x + north[2] * y,
    ]
    const l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
    const key = keyOf(tileOf([p[0] / l, p[1] / l, p[2] / l], OBJECT_LEVEL))
    if (seen.has(key)) continue
    // FIX: o alcance para no primeiro ponto cujo ladrilho não cabe, e o shader esmaece até ali
    if (keys.length >= budget) return { keys, reach: gap }
    seen.add(key)
    keys.push(key)
  }
  return { keys, reach: target }
}
