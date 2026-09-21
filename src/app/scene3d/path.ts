import { profile } from '../../engine/distance.ts'
import type { RangeResult } from '../sim/client.ts'
import { sampleRow } from '../current/geometry.ts'
import { SAMPLES, sampleYear, yearToAxis } from './space.ts'

export const PATH_ROWS = 3

export interface PathData {
  readonly data: Float32Array
  readonly alive: readonly [number, number]
  readonly samples: number
}

export function buildPath(
  range: RangeResult,
  offsets: Float32Array,
  from: number,
  to: number,
  start: number,
  samples = SAMPLES,
): PathData {
  const data = new Float32Array(samples * PATH_ROWS * 4)
  const count = range.series.population.length
  const first = Math.max(start, range.from)
  const last = range.to
  const span = Math.max(1, to - from)
  const bucketSpan = Math.max(1, range.to - range.from)
  for (let i = 0; i < samples; i++) {
    const year = sampleYear(i, from, to, samples)
    const k = Math.min(
      count - 1,
      Math.max(0, Math.round(((year - range.from) / bucketSpan) * (count - 1))),
    )
    const values = count > 0 ? profile(sampleRow(range.series, k)) : [0, 0, 0, 0, 0, 0, 0]
    const row0 = i * 4
    const row1 = (samples + i) * 4
    const row2 = (samples * 2 + i) * 4
    data[row0] = yearToAxis(year, from, to)
    data[row0 + 1] = offsets[i * 2] ?? 0
    data[row0 + 2] = offsets[i * 2 + 1] ?? 0
    data[row0 + 3] = values[6] ?? 0
    data[row1] = values[0] ?? 0
    data[row1 + 1] = values[1] ?? 0
    data[row1 + 2] = values[2] ?? 0
    data[row1 + 3] = values[3] ?? 0
    data[row2] = values[4] ?? 0
    data[row2 + 1] = values[5] ?? 0
    data[row2 + 2] = count > 0 && year >= first - 1e-6 && year <= last + 1e-6 ? 1 : 0
  }
  const unit = (year: number) => Math.min(1, Math.max(0, (year - from) / span))
  return { data, alive: [unit(first), unit(Math.max(first, last))], samples }
}

export function axisPoint(path: PathData, u: number): [number, number, number] | null {
  if (!(u >= 0 && u <= 1)) return null
  const x = u * (path.samples - 1)
  const i = Math.floor(x)
  const j = Math.min(path.samples - 1, i + 1)
  const t = x - i
  const at = (k: number, c: number) => path.data[k * 4 + c] ?? 0
  return [0, 1, 2].map((c) => at(i, c) + (at(j, c) - at(i, c)) * t) as [number, number, number]
}

export function headPoint(path: PathData): [number, number, number] | null {
  return axisPoint(path, path.alive[1])
}
