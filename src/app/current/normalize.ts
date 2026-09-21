import { profile } from '../../engine/distance.ts'
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

const INDEX: Readonly<Record<Strand, number>> = {
  population: 0,
  food: 1,
  energy: 2,
  technology: 3,
  economy: 4,
  environment: 5,
}

export function normalize(strand: Strand, row: Row): number {
  return profile(row)[INDEX[strand]] ?? 0
}
