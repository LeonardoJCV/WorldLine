import type { Crossing } from './crossing.ts'
import type { Merge } from './merge.ts'
import { VARIABLES, type Decision, type Variable, type WorldState } from './state.ts'
import { system } from './system.ts'

export type GoldenScript = 'steady' | 'shifting' | 'crossed' | 'inherited' | 'merged'

export interface GoldenPlan {
  readonly decisions: readonly Decision[]
  readonly crossings: readonly Crossing[]
}

const SHIFTING: readonly Decision[] = [
  {
    tick: 100,
    allocation: { agriculture: 25, industry: 50, research: 20, conservation: 0, works: 5 },
  },
  {
    tick: 600,
    allocation: { agriculture: 50, industry: 5, research: 20, conservation: 20, works: 5 },
  },
  {
    tick: 1500,
    allocation: { agriculture: 30, industry: 15, research: 40, conservation: 10, works: 5 },
  },
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
    allocation: { agriculture: 20, industry: 35, research: 30, conservation: 10, works: 5 },
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

// FEAT: indústria e pesquisa sem trégua, o único caminho que chega à era espacial
const SPACEFARING: readonly Decision[] = [
  {
    tick: 0,
    allocation: { agriculture: 15, industry: 50, research: 30, conservation: 0, works: 5 },
  },
]

// FEAT: um presente que um mundo de tecnologia saturada não tem como quitar; a dívida vira
// paradoxo, o paradoxo vence o prazo, e o mundo natal cai — com uma colônia de pé
const UNPAYABLE: readonly Crossing[] = [
  {
    tick: 1950,
    kind: 'knowledge',
    dose: 3,
    amounts: [5],
    origin: { world: 'B', tick: 1950 },
    cost: 30,
    direction: 'in',
  },
]

// FEAT: a história que recebe a confluência — duas viradas e nenhuma travessia, para a costura ser
// a única coisa que lhe chega de fora
const CONFLUENT: readonly Decision[] = [
  {
    tick: 0,
    allocation: { agriculture: 45, industry: 20, research: 20, conservation: 10, works: 5 },
  },
  {
    tick: 800,
    allocation: { agriculture: 35, industry: 25, research: 25, conservation: 10, works: 5 },
  },
]

export const GOLDEN_SCRIPTS: Readonly<Record<GoldenScript, GoldenPlan>> = {
  steady: { decisions: [], crossings: [] },
  shifting: { decisions: SHIFTING, crossings: [] },
  crossed: { decisions: SHIFTING, crossings: CROSSED },
  inherited: { decisions: SPACEFARING, crossings: UNPAYABLE },
  merged: { decisions: CONFLUENT, crossings: [] },
}

export interface GoldenCase {
  readonly seed: number
  readonly script: GoldenScript
  readonly year: number
  readonly hash: string
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { seed: 1, script: 'steady', year: 1000, hash: 'abd3d2dc' },
  { seed: 1, script: 'steady', year: 5000, hash: '8e525a9f' },
  { seed: 1, script: 'shifting', year: 1000, hash: 'da966e36' },
  { seed: 1, script: 'shifting', year: 5000, hash: '671a3cf0' },
  { seed: 482913, script: 'steady', year: 1000, hash: '1bb3adda' },
  { seed: 482913, script: 'steady', year: 5000, hash: '6582d2fc' },
  { seed: 482913, script: 'shifting', year: 1000, hash: 'd7cb5f60' },
  { seed: 482913, script: 'shifting', year: 5000, hash: '5067b926' },
  { seed: 0xffffffff, script: 'steady', year: 1000, hash: '8c23811b' },
  { seed: 0xffffffff, script: 'steady', year: 5000, hash: '294c54eb' },
  { seed: 0xffffffff, script: 'shifting', year: 1000, hash: '0245fcd7' },
  { seed: 0xffffffff, script: 'shifting', year: 5000, hash: '75420923' },
  { seed: 482913, script: 'crossed', year: 1000, hash: '7d4221bb' },
  { seed: 482913, script: 'crossed', year: 5000, hash: 'e4974c9b' },
]

// FEAT: o roteiro que sobrevive ao próprio mundo, fora dos doze para não mexer em nenhum deles
export interface InheritanceCase {
  readonly seed: number
  readonly script: GoldenScript
  // FEAT: o ano em que a colônia herdeira foi fundada, o ano em que o mundo natal caiu e o
  // primeiro ano da história na casa nova, onde o fingerprint é fixado
  readonly founded: number
  readonly ended: number
  readonly year: number
  readonly hash: string
}

export const INHERITANCE_CASE: InheritanceCase = {
  seed: 482913,
  script: 'inherited',
  founded: 1951,
  ended: 2150,
  year: 2151,
  hash: '62643dc9',
}

// FEAT: um GoldenPlan descreve UMA história, e uma confluência são duas; o caso nomeia os dois
// roteiros, os dois nomes no recibo, o ano em que as duas viram uma e o ano do fingerprint
export interface MergeCase {
  readonly seed: number
  readonly script: GoldenScript
  readonly other: GoldenScript
  // FEAT: quem recebe se chama B porque B é a origem dos presentes de `crossed`, logo a dívida que
  // a que deságua ainda carrega é com ela mesma e a costura a dissolve
  readonly host: string
  readonly guest: string
  readonly tick: number
  readonly year: number
  readonly hash: string
}

export const MERGE_CASE: MergeCase = {
  seed: 482913,
  script: 'merged',
  other: 'crossed',
  host: 'B',
  guest: 'C',
  tick: 950,
  year: 1050,
  hash: '96291691',
}

export interface Seam {
  readonly receives: Merge
  readonly departs: Merge
}

function natalBody(seed: number): number {
  const home = system(seed).find((body) => body.home)
  if (!home) throw new Error(`world ${seed} has no home body`)
  return home.index
}

// FEAT: os dois recibos da mesma confluência, cada um escrito do lado que o recebe
export function mergeSeam(guest: WorldState): Seam {
  const values = {} as Record<Variable, number>
  for (const variable of VARIABLES) values[variable] = guest[variable]
  const { tick, host } = MERGE_CASE
  const natal = natalBody(MERGE_CASE.seed)
  return {
    receives: {
      tick,
      self: host,
      other: MERGE_CASE.guest,
      direction: 'in',
      natal,
      values,
      debts: guest.debts,
      echoes: guest.echoes,
      paradox: guest.paradox,
      strain: guest.strain,
      colonies: guest.colonies,
      home: guest.home,
    },
    departs: { tick, self: MERGE_CASE.guest, other: host, direction: 'out', natal },
  }
}
