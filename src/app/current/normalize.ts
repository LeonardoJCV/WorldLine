import type { Variable } from '../../engine/state.ts'

export const STRANDS = [
  'population',
  'food',
  'energy',
  'technology',
  'economy',
  'environment',
] as const satisfies readonly Variable[]
export type Strand = (typeof STRANDS)[number]

export type Row = Readonly<Record<Variable, number>>

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function normalize(strand: Strand, row: Row): number {
  switch (strand) {
    case 'population':
      return unit((Math.log10(Math.max(row.population, 1)) - 4) / 4)
    case 'food':
      return unit(row.food / Math.max(row.population, 1) / 0.6)
    case 'energy':
      return unit(row.energy / 15)
    case 'technology':
      return unit(row.technology / 100)
    case 'economy':
      return unit(row.economy / 15)
    case 'environment':
      return unit(row.environment / 100)
  }
}
