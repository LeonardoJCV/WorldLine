import { WORLDLINE_IDS, type WorldlineId } from '../../worker/protocol.ts'
import { movingAverage } from '../current/geometry.ts'

export const HALF_LENGTH = 12
export const SPREAD = 6
export const SAMPLES = 256
export const GOLDEN_ANGLE = (137.5 * Math.PI) / 180
const SMOOTHING = 4

export function yearToAxis(year: number, from: number, to: number): number {
  const span = Math.max(1, to - from)
  return -HALF_LENGTH + (2 * HALF_LENGTH * (year - from)) / span
}

export function axisToYear(x: number, from: number, to: number): number {
  const span = Math.max(1, to - from)
  return from + ((x + HALF_LENGTH) / (2 * HALF_LENGTH)) * span
}

export function sampleYear(i: number, from: number, to: number, samples = SAMPLES): number {
  return from + ((to - from) * i) / Math.max(1, samples - 1)
}

export function branchDirection(id: WorldlineId): readonly [number, number] {
  const angle = WORLDLINE_IDS.indexOf(id) * GOLDEN_ANGLE
  return [Math.cos(angle), Math.sin(angle)]
}

export function resample(
  values: Float32Array,
  srcFrom: number,
  srcTo: number,
  from: number,
  to: number,
  samples = SAMPLES,
): Float32Array {
  const out = new Float32Array(samples)
  const count = values.length
  if (count === 0) return out
  const span = Math.max(1, srcTo - srcFrom)
  for (let i = 0; i < samples; i++) {
    const year = sampleYear(i, from, to, samples)
    const k = Math.round(((year - srcFrom) / span) * (count - 1))
    out[i] = values[Math.min(count - 1, Math.max(0, k))] ?? 0
  }
  return out
}

export interface Lineage {
  readonly id: WorldlineId
  readonly parent: WorldlineId | null
  readonly distance: Float32Array | null
}

export function axisOffsets(lineages: readonly Lineage[]): Map<WorldlineId, Float32Array> {
  const offsets = new Map<WorldlineId, Float32Array>()
  for (const lineage of lineages) {
    const own = new Float32Array(SAMPLES * 2)
    const base = lineage.parent === null ? undefined : offsets.get(lineage.parent)
    if (base && lineage.distance) {
      const [dy, dz] = branchDirection(lineage.id)
      const smooth = movingAverage(lineage.distance, SMOOTHING)
      for (let i = 0; i < SAMPLES; i++) {
        const reach = SPREAD * (smooth[i] ?? 0)
        own[i * 2] = (base[i * 2] ?? 0) + dy * reach
        own[i * 2 + 1] = (base[i * 2 + 1] ?? 0) + dz * reach
      }
    }
    offsets.set(lineage.id, own)
  }
  return offsets
}
