import { tileOf, keyOf, type Vec3 } from './cube.ts'
import { OBJECT_LEVEL } from './objects.ts'

export const LIFE_FROM = 0.25
export const TILE_BUDGET = { low: 12, high: 30, ultra: 60 } as const
const GRID = 9

export function wantedTiles(dir: Vec3, altitude: number, budget: number): string[] {
  if (altitude >= LIFE_FROM) return []
  const radius = Math.min(0.12, altitude * 1.6 + 0.01)
  const ref: Vec3 = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0]
  const e0 = ref[1] * dir[2] - ref[2] * dir[1]
  const e1 = ref[2] * dir[0] - ref[0] * dir[2]
  const e2 = ref[0] * dir[1] - ref[1] * dir[0]
  const el = Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2) || 1
  const east: Vec3 = [e0 / el, e1 / el, e2 / el]
  const north: Vec3 = [
    dir[1] * east[2] - dir[2] * east[1],
    dir[2] * east[0] - dir[0] * east[2],
    dir[0] * east[1] - dir[1] * east[0],
  ]
  const found: { key: string; gap: number }[] = []
  const seen = new Set<string>()
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const dx = (i / (GRID - 1)) * 2 - 1
      const dy = (j / (GRID - 1)) * 2 - 1
      if (dx * dx + dy * dy > 1) continue
      const p: Vec3 = [
        dir[0] + (east[0] * dx + north[0] * dy) * radius,
        dir[1] + (east[1] * dx + north[1] * dy) * radius,
        dir[2] + (east[2] * dx + north[2] * dy) * radius,
      ]
      const l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
      const key = keyOf(tileOf([p[0] / l, p[1] / l, p[2] / l], OBJECT_LEVEL))
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ key, gap: dx * dx + dy * dy })
    }
  }
  found.sort((a, b) => a.gap - b.gap)
  return found.slice(0, budget).map((f) => f.key)
}
