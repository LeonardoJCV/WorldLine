import { ln } from './math.ts'
import type { Variable } from './state.ts'

export type Profile = readonly [number, number, number, number, number, number, number]

const LN10 = ln(10)

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function profile(values: Readonly<Record<Variable, number>>): Profile {
  return [
    unit((ln(Math.max(values.population, 1)) / LN10 - 4) / 4),
    unit(values.food / Math.max(values.population, 1) / 0.6),
    unit(values.energy / 15),
    unit(values.technology / 100),
    unit(values.economy / 15),
    unit(values.environment / 100),
    unit(values.stability / 100),
  ]
}

export function causalDistance(
  a: Readonly<Record<Variable, number>>,
  b: Readonly<Record<Variable, number>>,
): number {
  const pa = profile(a)
  const pb = profile(b)
  let sum = 0
  for (let i = 0; i < pa.length; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    sum += d * d
  }
  return Math.sqrt(sum / pa.length)
}
