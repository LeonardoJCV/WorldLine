import type { Commission } from './commission.ts'
import type { Crossing } from './crossing.ts'
import type { Merge } from './merge.ts'
import { VARIABLES, type Decision, type Variable, type WorldState } from './state.ts'
import { system } from './system.ts'
import type { WorkId } from './work.ts'
import { Worldline } from './worldline.ts'

export type GoldenScript = 'steady' | 'shifting' | 'crossed' | 'inherited' | 'merged' | 'building'

export interface GoldenPlan {
  readonly decisions: readonly Decision[]
  readonly crossings: readonly Crossing[]
  // FEAT: a obra que o roteiro encomenda no ano em que o canteiro ficou livre; sem ela um roteiro
  // de referência nunca chega ao foguete, e sem foguete nenhuma história coloniza
  readonly commissions: readonly Commission[]
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

// FEAT: a alocação de `WORKS_PATH`, a que a calibração conduz até o foguete: medido, a de antes
// (a15 i50 r30 c0 w5) extingue por volta do ano 970 quando o mundo passa a construir de verdade
const SPACEFARING: readonly Decision[] = [
  {
    tick: 0,
    allocation: { agriculture: 25, industry: 25, research: 20, conservation: 5, works: 25 },
  },
]

// FEAT: o catálogo inteiro, cada obra no ano em que o canteiro ficou livre para ela — anos medidos
// conduzindo a alocação acima na ordem que o jogo apresenta, não anos escolhidos à mão
const CLIMB: readonly Commission[] = [
  { tick: 396, work: 'irrigation' },
  { tick: 405, work: 'plough' },
  { tick: 416, work: 'granary' },
  { tick: 423, work: 'calendar' },
  { tick: 432, work: 'pottery' },
  { tick: 872, work: 'writing' },
  { tick: 882, work: 'roads' },
  { tick: 896, work: 'coinage' },
  { tick: 910, work: 'aqueduct' },
  { tick: 924, work: 'navigation' },
  { tick: 939, work: 'reforestation' },
  { tick: 999, work: 'printing' },
  { tick: 1026, work: 'metallurgy' },
  { tick: 1049, work: 'steam' },
  { tick: 1070, work: 'railway' },
  { tick: 1091, work: 'sanitation' },
  { tick: 1100, work: 'filters' },
  { tick: 1472, work: 'electrification' },
  { tick: 1483, work: 'telegraph' },
  { tick: 1496, work: 'chemistry' },
  { tick: 1510, work: 'medicine' },
  { tick: 1522, work: 'computer' },
  { tick: 1535, work: 'cleanGrid' },
  { tick: 1726, work: 'arcology' },
  { tick: 1751, work: 'reactor' },
  { tick: 1782, work: 'closedCycle' },
  { tick: 1810, work: 'launchpad' },
  { tick: 1902, work: 'telemetry' },
  { tick: 1993, work: 'propellant' },
  { tick: 2087, work: 'rocket' },
  { tick: 2182, work: 'orbit' },
  { tick: 2191, work: 'shipyard' },
]

// FEAT: um empréstimo que fecha um ciclo entre duas histórias: o paradoxo chega com a travessia e
// a tecnologia saturada nunca quita a dívida que o desfaria, então o prazo vence e o mundo natal
// cai — com uma colônia de pé. O ciclo, e não a dívida grande, porque `credit()` limita o gasto de
// um multiverso inteiro a 72 e a razão de 72 só alcança o limiar num mundo de tamanho abaixo de 186
const UNPAYABLE: readonly Crossing[] = [
  {
    tick: 2270,
    kind: 'knowledge',
    dose: 3,
    amounts: [5],
    origin: { world: 'B', tick: 2270 },
    cost: 30,
    direction: 'in',
    circular: true,
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

// FEAT: uma história comum que constrói — nenhuma travessia, nenhuma costura, nenhuma colônia, só
// 15% do ano em obra, para o fingerprint do caso ser a obra e mais nada
const BUILDER: readonly Decision[] = [
  {
    tick: 0,
    allocation: { agriculture: 35, industry: 25, research: 20, conservation: 5, works: 15 },
  },
]

// FEAT: sete obras nos anos em que o canteiro ficou livre nesta semente, e a sétima ainda está no
// canteiro no ano fixado, medida a 1697,27 dos 2400 que `roads` custa: é ela que põe `building` no
// hash, e as seis prontas que põem `works`
const SEVEN: readonly Commission[] = [
  { tick: 396, work: 'irrigation' },
  { tick: 408, work: 'plough' },
  { tick: 423, work: 'granary' },
  { tick: 432, work: 'calendar' },
  { tick: 444, work: 'pottery' },
  { tick: 871, work: 'writing' },
  { tick: 886, work: 'roads' },
]

export const GOLDEN_SCRIPTS: Readonly<Record<GoldenScript, GoldenPlan>> = {
  steady: { decisions: [], crossings: [], commissions: [] },
  shifting: { decisions: SHIFTING, crossings: [], commissions: [] },
  crossed: { decisions: SHIFTING, crossings: CROSSED, commissions: [] },
  inherited: { decisions: SPACEFARING, crossings: UNPAYABLE, commissions: CLIMB },
  merged: { decisions: CONFLUENT, crossings: [], commissions: [] },
  building: { decisions: BUILDER, crossings: [], commissions: SEVEN },
}

// FEAT: um roteiro de referência são três listas, e montá-lo num lugar só é o que impede um
// consumidor de esquecer as comissões e ler um mundo que nunca chegou ao foguete
export function goldenWorld(seed: number, plan: GoldenPlan): Worldline {
  return new Worldline(seed, plan.decisions, null, plan.crossings, [], plan.commissions)
}

export interface GoldenCase {
  readonly seed: number
  readonly script: GoldenScript
  readonly year: number
  readonly hash: string
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { seed: 1, script: 'steady', year: 1000, hash: '33127513' },
  { seed: 1, script: 'steady', year: 5000, hash: 'fdb5d40e' },
  { seed: 1, script: 'shifting', year: 1000, hash: 'da966e36' },
  { seed: 1, script: 'shifting', year: 5000, hash: '459716dc' },
  { seed: 482913, script: 'steady', year: 1000, hash: 'b95a67cb' },
  { seed: 482913, script: 'steady', year: 5000, hash: '9bca7009' },
  { seed: 482913, script: 'shifting', year: 1000, hash: '88815910' },
  { seed: 482913, script: 'shifting', year: 5000, hash: 'cc92b6e5' },
  { seed: 0xffffffff, script: 'steady', year: 1000, hash: 'e4666993' },
  { seed: 0xffffffff, script: 'steady', year: 5000, hash: '84aaf346' },
  { seed: 0xffffffff, script: 'shifting', year: 1000, hash: '8bc9e908' },
  { seed: 0xffffffff, script: 'shifting', year: 5000, hash: '33dc97ba' },
  { seed: 482913, script: 'crossed', year: 1000, hash: '13c3a6fd' },
  { seed: 482913, script: 'crossed', year: 5000, hash: 'cef8326a' },
]

// FEAT: o décimo-oitavo caso, fora dos dezessete: uma história que ainda corre e que construiu. Sem
// ele os dezessete provam só que mundos SEM obra reproduzem — a herança constrói, mas termina num
// corpo novo, e nenhum caso publicado tinha `works` e `building` preenchidos num mundo comum
export interface WorksCase {
  readonly seed: number
  readonly script: GoldenScript
  // FEAT: quantas obras estão prontas no ano fixado, e qual ficou no canteiro nesse ano
  readonly done: number
  readonly under: WorkId
  readonly year: number
  readonly hash: string
}

export const WORKS_CASE: WorksCase = {
  seed: 482913,
  script: 'building',
  done: 6,
  under: 'roads',
  year: 900,
  hash: 'a2d33a0f',
}

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
  founded: 2182,
  ended: 2470,
  year: 2471,
  hash: '3681f2a0',
}

// FEAT: a mesma herança com uma irmã: a semente 4242 tem dois corpos que comportam uma colônia, e
// esta alocação funda as duas antes da queda, para o luto orfanar uma irmã de verdade
const SISTERLY: readonly Decision[] = [
  {
    tick: 0,
    allocation: { agriculture: 40, industry: 25, research: 20, conservation: 10, works: 5 },
  },
  // FEAT: a virada para o céu, na mesma alocação que a calibração conduz até o foguete
  {
    tick: 400,
    allocation: { agriculture: 25, industry: 25, research: 20, conservation: 5, works: 25 },
  },
]

// FEAT: o catálogo inteiro, nos anos em que o canteiro ficou livre nesta semente, que são outros
const SISTERLY_CLIMB: readonly Commission[] = [
  { tick: 432, work: 'irrigation' },
  { tick: 440, work: 'plough' },
  { tick: 450, work: 'granary' },
  { tick: 456, work: 'calendar' },
  { tick: 464, work: 'pottery' },
  { tick: 914, work: 'writing' },
  { tick: 924, work: 'roads' },
  { tick: 937, work: 'coinage' },
  { tick: 950, work: 'aqueduct' },
  { tick: 963, work: 'navigation' },
  { tick: 977, work: 'reforestation' },
  { tick: 1041, work: 'printing' },
  { tick: 1063, work: 'metallurgy' },
  { tick: 1084, work: 'steam' },
  { tick: 1104, work: 'railway' },
  { tick: 1124, work: 'sanitation' },
  { tick: 1133, work: 'filters' },
  { tick: 1513, work: 'electrification' },
  { tick: 1524, work: 'telegraph' },
  { tick: 1536, work: 'chemistry' },
  { tick: 1548, work: 'medicine' },
  { tick: 1560, work: 'computer' },
  { tick: 1572, work: 'cleanGrid' },
  { tick: 1766, work: 'arcology' },
  { tick: 1790, work: 'reactor' },
  { tick: 1818, work: 'closedCycle' },
  { tick: 1845, work: 'launchpad' },
  { tick: 1932, work: 'telemetry' },
  { tick: 2017, work: 'propellant' },
  { tick: 2105, work: 'rocket' },
  { tick: 2195, work: 'orbit' },
  { tick: 2204, work: 'shipyard' },
]

// FEAT: o mesmo ciclo de `UNPAYABLE`, e pelo mesmo motivo, duzentos anos antes da queda
const SISTERLY_CYCLE: readonly Crossing[] = [
  {
    tick: 2300,
    kind: 'knowledge',
    dose: 3,
    amounts: [5],
    origin: { world: 'B', tick: 2300 },
    cost: 30,
    direction: 'in',
    circular: true,
  },
]

// FEAT: fica fora dos dezessete porque não fixa fingerprint nenhum — fixa anos, e mora aqui em vez
// do diretório do e2e para o vitest poder guardá-los; sem guarda, uma comissão perdida só apareceria
// como um teste de navegador esperando noventa segundos por uma linha que nunca chega
export interface SiblingCase {
  readonly seed: number
  readonly plan: GoldenPlan
  // FEAT: os anos das duas fundações, o da queda, e o da refundação que o herdeiro faz depois dela
  readonly founded: readonly number[]
  readonly ended: number
  readonly refounded: number
}

export const SIBLING_CASE: SiblingCase = {
  seed: 4242,
  plan: { decisions: SISTERLY, crossings: SISTERLY_CYCLE, commissions: SISTERLY_CLIMB },
  founded: [2195, 2196],
  ended: 2500,
  refounded: 2506,
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
  hash: 'ff427866',
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
      works: guest.works,
    },
    departs: { tick, self: MERGE_CASE.guest, other: host, direction: 'out', natal },
  }
}
