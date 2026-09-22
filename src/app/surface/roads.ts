import type { SurfaceModel } from './civilization.ts'
import type { Site } from './sites.ts'
import { surfaceRadius, type Terrain } from './terrain.ts'

export const ROAD_SAMPLES = 64
const COS_REACH = 0.955336489125606
const LIFT = 0.0003

export interface Road {
  readonly from: number
  readonly to: number
  readonly points: Float32Array
  readonly wet: Uint8Array
}

export function aliveKey(model: SurfaceModel | null): string {
  if (!model) return ''
  return model.cities
    .filter((c) => c.state === 'alive')
    .map((c) => c.site)
    .join()
}

export function buildRoads(
  model: SurfaceModel,
  sites: readonly Site[],
  terrain: Terrain,
  samples = ROAD_SAMPLES,
): Road[] {
  const alive = model.cities
    .filter((c) => c.state === 'alive')
    .map((c) => sites[c.site])
    .filter((s): s is Site => s !== undefined)
  const roads: Road[] = []
  const steps = Math.max(2, samples)
  alive.forEach((site, i) => {
    let best: Site | null = null
    let bestDot = COS_REACH
    for (let j = 0; j < i; j++) {
      const other = alive[j]
      if (!other) continue
      const dot =
        site.dir[0] * other.dir[0] + site.dir[1] * other.dir[1] + site.dir[2] * other.dir[2]
      if (dot > bestDot) {
        bestDot = dot
        best = other
      }
    }
    if (!best) return
    const points = new Float32Array(steps * 3)
    const wet = new Uint8Array(steps)
    for (let k = 0; k < steps; k++) {
      const t = k / (steps - 1)
      const x = site.dir[0] + (best.dir[0] - site.dir[0]) * t
      const y = site.dir[1] + (best.dir[1] - site.dir[1]) * t
      const z = site.dir[2] + (best.dir[2] - site.dir[2]) * t
      const l = Math.sqrt(x * x + y * y + z * z)
      const s = terrain.sample(x / l, y / l, z / l)
      wet[k] = s.biome === 'ocean' ? 1 : 0
      const r = Math.max(surfaceRadius(s.height), 1) + LIFT
      points[k * 3] = (x / l) * r
      points[k * 3 + 1] = (y / l) * r
      points[k * 3 + 2] = (z / l) * r
    }
    roads.push({ from: site.index, to: best.index, points, wet })
  })
  return roads
}
