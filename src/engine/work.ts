import { Era } from './state.ts'

export type WorkId =
  | 'irrigation'
  | 'plough'
  | 'granary'
  | 'calendar'
  | 'pottery'
  | 'writing'
  | 'roads'
  | 'coinage'
  | 'aqueduct'
  | 'navigation'
  | 'printing'
  | 'metallurgy'
  | 'steam'
  | 'railway'
  | 'sanitation'
  | 'electrification'
  | 'telegraph'
  | 'chemistry'
  | 'medicine'
  | 'computer'
  | 'rocket'
  | 'orbit'
  | 'shipyard'
  | 'arcology'
  | 'reactor'
  | 'reforestation'
  | 'filters'
  | 'cleanGrid'
  | 'closedCycle'

export const FACTOR_KEYS = [
  'harvest',
  'production',
  'research',
  'energy',
  'economy',
  'capacity',
  'colonyCost',
  // FEAT: fator sobre o termo de poluição inteiro, e por ser fator positivo nunca fica negativo —
  // é por isso que ele dispensa o piso que `spoil` e `mortality` precisam
  'smoke',
] as const
export const TERM_KEYS = ['mortality', 'spoil', 'harvestNoise', 'pollution'] as const
export type FactorKey = (typeof FACTOR_KEYS)[number]
export type TermKey = (typeof TERM_KEYS)[number]
export type WorkKey = FactorKey | TermKey

export interface WorkDef {
  readonly id: WorkId
  readonly era: number
  readonly needs: readonly WorkId[]
  readonly cost: number
  readonly effect: Readonly<Partial<Record<WorkKey, number>>>
}

export type WorkMods = Readonly<Record<WorkKey, number>>

export interface Work {
  readonly def: number
  readonly done: number
  readonly record: number
}

export interface Building {
  readonly def: number
  readonly progress: number
  readonly since: number
}

export const WORKS: readonly WorkDef[] = [
  { id: 'irrigation', era: Era.agricultural, needs: [], cost: 600, effect: { harvest: 1.12 } },
  {
    id: 'plough',
    era: Era.agricultural,
    needs: ['irrigation'],
    cost: 800,
    effect: { harvest: 1.1 },
  },
  { id: 'granary', era: Era.agricultural, needs: [], cost: 500, effect: { spoil: -0.08 } },
  {
    id: 'calendar',
    era: Era.agricultural,
    needs: ['irrigation'],
    cost: 700,
    effect: { harvestNoise: -0.04 },
  },
  { id: 'pottery', era: Era.agricultural, needs: [], cost: 450, effect: { economy: 1.05 } },
  { id: 'writing', era: Era.classical, needs: [], cost: 1800, effect: { research: 1.2 } },
  {
    id: 'roads',
    era: Era.classical,
    needs: ['writing'],
    cost: 2400,
    effect: { economy: 1.08 },
  },
  {
    id: 'coinage',
    era: Era.classical,
    needs: ['writing'],
    cost: 2600,
    effect: { economy: 1.12 },
  },
  {
    id: 'aqueduct',
    era: Era.classical,
    needs: ['roads'],
    cost: 3000,
    effect: { mortality: -0.005, capacity: 1.06 },
  },
  {
    id: 'navigation',
    era: Era.classical,
    needs: ['roads'],
    cost: 3400,
    effect: { economy: 1.1 },
  },
  {
    id: 'printing',
    era: Era.industrial,
    needs: ['writing'],
    cost: 7000,
    effect: { research: 1.35 },
  },
  {
    id: 'metallurgy',
    era: Era.industrial,
    needs: ['coinage'],
    cost: 8000,
    effect: { production: 1.15 },
  },
  {
    id: 'steam',
    era: Era.industrial,
    needs: ['metallurgy'],
    cost: 11000,
    effect: { energy: 1.8 },
  },
  {
    id: 'railway',
    era: Era.industrial,
    needs: ['steam'],
    cost: 14000,
    effect: { economy: 1.2, production: 1.1 },
  },
  {
    id: 'sanitation',
    era: Era.industrial,
    needs: ['aqueduct'],
    cost: 9000,
    effect: { mortality: -0.012 },
  },
  {
    id: 'electrification',
    era: Era.electric,
    needs: ['steam'],
    cost: 22000,
    effect: { energy: 1.6 },
  },
  {
    id: 'telegraph',
    era: Era.electric,
    needs: ['electrification'],
    cost: 26000,
    effect: { research: 1.15 },
  },
  {
    id: 'chemistry',
    era: Era.electric,
    needs: ['metallurgy'],
    cost: 30000,
    effect: { harvest: 1.25, pollution: 0.04 },
  },
  {
    id: 'medicine',
    era: Era.electric,
    needs: ['sanitation'],
    cost: 34000,
    effect: { mortality: -0.02 },
  },
  {
    id: 'computer',
    era: Era.electric,
    needs: ['telegraph'],
    cost: 42000,
    effect: { research: 1.5 },
  },
  // FEAT: efeito vazio de propósito — o foguete abre o portão da colonização, não empurra coeficiente
  // FEAT: o primeiro a sair do planeta custa séculos da obra pública inteira, e é só por isso que o
  // céu fica no terceiro milênio: a era espacial já abriu séculos antes dele, e o resto dela é barato
  { id: 'rocket', era: Era.space, needs: ['computer'], cost: 2400000, effect: {} },
  {
    id: 'orbit',
    era: Era.space,
    needs: ['rocket'],
    cost: 70000,
    effect: { research: 1.2 },
  },
  {
    id: 'shipyard',
    era: Era.space,
    needs: ['rocket'],
    cost: 80000,
    effect: { colonyCost: 0.7 },
  },
  {
    id: 'arcology',
    era: Era.space,
    needs: ['computer'],
    cost: 90000,
    effect: { capacity: 1.3 },
  },
  {
    id: 'reactor',
    era: Era.space,
    needs: ['electrification', 'computer'],
    cost: 110000,
    effect: { energy: 2.2 },
  },
  // FEAT: a escada de mitigação, apendada ao fim porque o índice entra no hash — a resposta de cada
  // degrau da escada de energia, e na árvore ela vem depois do problema que responde
  {
    id: 'reforestation',
    era: Era.classical,
    needs: ['roads'],
    cost: 2800,
    effect: { smoke: 0.85 },
  },
  {
    id: 'filters',
    era: Era.industrial,
    needs: ['steam'],
    cost: 12000,
    effect: { smoke: 0.8 },
  },
  {
    id: 'cleanGrid',
    era: Era.electric,
    needs: ['electrification'],
    cost: 28000,
    effect: { smoke: 0.75 },
  },
  {
    id: 'closedCycle',
    era: Era.space,
    needs: ['reactor'],
    cost: 120000,
    effect: { smoke: 0.7 },
  },
]

// FEAT: a ordem de ARMAZENAMENTO é contrato de hash e a de APRESENTAÇÃO é escolha de produto, e é
// por isso que as duas diferem: a obra nova entra no fim do array e no meio da árvore
export const PRESENTATION_ORDER: readonly number[] = WORKS.map((work, def) => ({
  def,
  era: work.era,
}))
  .sort((a, b) => (a.era === b.era ? a.def - b.def : a.era - b.era))
  .map((entry) => entry.def)

export const NEUTRAL_MODS: WorkMods = (() => {
  const mods = {} as Record<WorkKey, number>
  for (const key of FACTOR_KEYS) mods[key] = 1
  for (const key of TERM_KEYS) mods[key] = 0
  return mods
})()

export function workMods(works: readonly Work[]): WorkMods {
  const mods = { ...NEUTRAL_MODS } as Record<WorkKey, number>
  for (const work of works) {
    const effect = WORKS[work.def]?.effect
    if (!effect) continue
    for (const key of FACTOR_KEYS) {
      const factor = effect[key]
      if (factor !== undefined) mods[key] *= factor
    }
    for (const key of TERM_KEYS) {
      const term = effect[key]
      if (term !== undefined) mods[key] += term
    }
  }
  return mods
}

export function findWork(id: WorkId): WorkDef {
  const work = WORKS.find((w) => w.id === id)
  if (!work) throw new Error(`unknown work: ${id}`)
  return work
}

export function workIndex(id: WorkId): number {
  const index = WORKS.findIndex((w) => w.id === id)
  if (index === -1) throw new Error(`unknown work: ${id}`)
  return index
}

export function isCommissionable(
  state: { readonly eras: number; readonly works: readonly Work[] },
  index: number,
): boolean {
  const work = WORKS[index]
  if (!work) return false
  if ((state.eras & work.era) === 0) return false
  if (state.works.some((done) => done.def === index)) return false
  return work.needs.every((need) => state.works.some((done) => WORKS[done.def]?.id === need))
}
