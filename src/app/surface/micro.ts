import { uniform } from '../../engine/rng.ts'
import type { Variable } from '../../engine/state.ts'
import { thresholds } from './civilization.ts'
import { MAX_SITES, type Site } from './sites.ts'

export const MICRO_KINDS = [
  'founding',
  'harvest',
  'outbreak',
  'fire',
  'invention',
  'harbour',
  'revolt',
] as const
export type MicroKind = (typeof MICRO_KINDS)[number]
export const MAX_PER_YEAR = 2
const HAPPEN = 8192 + 128
const WHERE = 8192 + 160

export interface MicroEvent {
  readonly year: number
  readonly kind: MicroKind
  readonly site: number
}

export interface YearSeries {
  readonly from: number
  readonly to: number
  readonly values: Readonly<Record<Variable, Float32Array>>
}

export interface MicroInput {
  readonly seed: number
  readonly sites: readonly Site[]
  readonly series: YearSeries
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

type Chance = (v: Readonly<Record<Variable, number>>) => number

const CHANCE: Readonly<Record<Exclude<MicroKind, 'founding'>, Chance>> = {
  harvest: (v) => 0.02 + 0.06 * clamp01(v.food / Math.max(v.population, 1) / 0.6),
  outbreak: (v) =>
    0.01 + 0.08 * clamp01(v.population / 50_000_000) * (1 - clamp01(v.stability / 100)),
  fire: (v) => 0.01 + 0.06 * (1 - clamp01(v.environment / 100)),
  invention: (v) => 0.01 + 0.07 * clamp01(v.technology / 100),
  harbour: (v) => 0.005 + 0.05 * clamp01(v.economy / 15),
  revolt: (v) => 0.01 + 0.08 * (1 - clamp01(v.stability / 100)),
}

export function microevents({ seed, sites, series }: MicroInput): MicroEvent[] {
  const limits = thresholds(Math.min(sites.length, MAX_SITES))
  const events: MicroEvent[] = []
  const at = (variable: Variable, i: number) => series.values[variable][i] ?? 0
  const span = series.to - series.from + 1
  for (let i = 0; i < span; i++) {
    const year = series.from + i
    const population = at('population', i)
    const alive = limits.filter((t) => t <= population).length
    if (i > 0 || year === 0) {
      const before = i > 0 ? at('population', i - 1) : 0
      limits.forEach((limit, k) => {
        if (before < limit && limit <= population) events.push({ year, kind: 'founding', site: k })
      })
    }
    if (alive === 0) continue
    const values = {} as Record<Variable, number>
    for (const variable of Object.keys(series.values) as Variable[])
      values[variable] = at(variable, i)
    let happened = 0
    MICRO_KINDS.forEach((kind, index) => {
      if (kind === 'founding' || happened >= MAX_PER_YEAR) return
      if (uniform(seed, year, HAPPEN + index) >= CHANCE[kind](values)) return
      const pool =
        kind === 'harbour'
          ? Array.from({ length: alive }, (_, k) => k).filter((k) => sites[k]?.coast)
          : Array.from({ length: alive }, (_, k) => k)
      if (pool.length === 0) return
      // FIX: sorteio ao quadrado favorece as cidades maiores (índice menor)
      const u = uniform(seed, year, WHERE + index)
      const site = pool[Math.min(pool.length - 1, Math.floor(u * u * pool.length))]
      if (site === undefined) return
      events.push({ year, kind, site })
      happened += 1
    })
  }
  return events
}
