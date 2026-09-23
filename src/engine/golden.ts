import type { Crossing } from './crossing.ts'
import type { Decision } from './state.ts'

export type GoldenScript = 'steady' | 'shifting' | 'crossed'

export interface GoldenPlan {
  readonly decisions: readonly Decision[]
  readonly crossings: readonly Crossing[]
}

const SHIFTING: readonly Decision[] = [
  { tick: 100, allocation: { agriculture: 25, industry: 55, research: 20, conservation: 0 } },
  { tick: 600, allocation: { agriculture: 50, industry: 10, research: 20, conservation: 20 } },
  { tick: 1500, allocation: { agriculture: 30, industry: 20, research: 40, conservation: 10 } },
]

// FEAT: parcelas fixas no arquivo para o roteiro não depender de outro mundo
const CROSSED: readonly Crossing[] = [
  {
    tick: 400,
    kind: 'knowledge',
    dose: 3,
    amounts: [4.56],
    origin: { world: 'B', tick: 400 },
    cost: 14,
    direction: 'in',
  },
  {
    tick: 700,
    kind: 'doctrine',
    dose: 1,
    amounts: [],
    origin: { world: 'B', tick: 700 },
    cost: 2,
    direction: 'in',
    allocation: { agriculture: 20, industry: 40, research: 30, conservation: 10 },
  },
  {
    tick: 900,
    kind: 'resource',
    dose: 2,
    amounts: [103035.4, 0.35],
    origin: { world: 'B', tick: 900 },
    cost: 6,
    direction: 'in',
  },
  {
    tick: 1500,
    kind: 'people',
    dose: 1,
    amounts: [326018.3],
    origin: { world: 'B', tick: 1500 },
    cost: 5,
    direction: 'in',
  },
]

export const GOLDEN_SCRIPTS: Readonly<Record<GoldenScript, GoldenPlan>> = {
  steady: { decisions: [], crossings: [] },
  shifting: { decisions: SHIFTING, crossings: [] },
  crossed: { decisions: SHIFTING, crossings: CROSSED },
}

export interface GoldenCase {
  readonly seed: number
  readonly script: GoldenScript
  readonly year: number
  readonly hash: string
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { seed: 1, script: 'steady', year: 1000, hash: '177ac51d' },
  { seed: 1, script: 'steady', year: 5000, hash: '537a5d92' },
  { seed: 1, script: 'shifting', year: 1000, hash: 'aeb1cbca' },
  { seed: 1, script: 'shifting', year: 5000, hash: 'ddcfedc9' },
  { seed: 482913, script: 'steady', year: 1000, hash: '470d2965' },
  { seed: 482913, script: 'steady', year: 5000, hash: 'a42a4111' },
  { seed: 482913, script: 'shifting', year: 1000, hash: '4f80c4a1' },
  { seed: 482913, script: 'shifting', year: 5000, hash: '1c51ab0d' },
  { seed: 0xffffffff, script: 'steady', year: 1000, hash: '648dbea4' },
  { seed: 0xffffffff, script: 'steady', year: 5000, hash: '68b49e5f' },
  { seed: 0xffffffff, script: 'shifting', year: 1000, hash: 'ae5e39c0' },
  { seed: 0xffffffff, script: 'shifting', year: 5000, hash: '795871e1' },
  { seed: 482913, script: 'crossed', year: 1000, hash: '6fe1fab6' },
  { seed: 482913, script: 'crossed', year: 5000, hash: '8347686d' },
]
