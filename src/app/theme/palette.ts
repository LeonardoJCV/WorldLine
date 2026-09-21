import type { Strand } from '../current/normalize.ts'

export const STRAND_COLORS: Readonly<Record<Strand, string>> = {
  population: '#ee77ae',
  food: '#f2d35e',
  energy: '#c9501e',
  technology: '#3574d8',
  economy: '#c9aeff',
  environment: '#1fa58a',
}
