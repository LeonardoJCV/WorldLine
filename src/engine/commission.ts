import { HORIZON, PARAMS as K } from './params.ts'
import type { WorldState } from './state.ts'
import {
  WORKS,
  isCommissionable,
  workMods,
  type Building,
  type Work,
  type WorkId,
  type WorkMods,
} from './work.ts'

export interface Commission {
  readonly tick: number
  readonly work: WorkId
}

// FEAT: o ano de obra sai da produção do ano, nunca de um estoque; população entra pela raiz
// para que dez mil anos de crescimento não achatem os custos das últimas obras
export function progressWork(s: WorldState, mods: WorkMods): number {
  const share = s.allocation.works / 100
  return K.workRate * share * s.economy * Math.sqrt(s.population / 1e6) * mods.production
}

export function validateCommissions(commissions: readonly Commission[]): Commission[] {
  let previous = -1
  for (const commission of commissions) {
    if (
      !Number.isInteger(commission.tick) ||
      commission.tick <= previous ||
      commission.tick >= HORIZON
    ) {
      throw new RangeError('commissions must have increasing whole years inside the horizon')
    }
    if (WORKS.every((work) => work.id !== commission.work)) {
      throw new RangeError(`unknown work: ${commission.work}`)
    }
    previous = commission.tick
  }
  return commissions.map((c) => ({ tick: c.tick, work: c.work }))
}

// FIX: a obra fechada entra em ordem de `def`, não de conclusão, para haver uma ordem só: multiplicar
// em ponto flutuante não é comutativo no último bit, e a costura une por `def` e reordenaria a lista
function filed(works: readonly Work[], done: Work): readonly Work[] {
  const at = works.findIndex((work) => work.def > done.def)
  return at < 0 ? [...works, done] : [...works.slice(0, at), done, ...works.slice(at)]
}

export interface WorkYear {
  readonly works: readonly Work[]
  readonly building: Building | null
  // FEAT: o índice no catálogo da obra que ficou pronta neste ano, ou null
  readonly finished: number | null
}

// FEAT: uma comissão sem a era aberta, sem pré-requisito ou já cumprida é IGNORADA e não recusada,
// porque um ramo que divergiu antes revive o mesmo ano sem a era e lançar mataria o link
export function tickWork(s: WorldState, nextRecord: number, commission?: Commission): WorkYear {
  let building = s.building
  if (commission) {
    const index = WORKS.findIndex((work) => work.id === commission.work)
    if (index >= 0 && isCommissionable(s, index)) {
      building = { def: index, progress: 0, since: s.tick }
    }
  }
  const def = building ? WORKS[building.def] : undefined
  if (!building || !def) return { works: s.works, building: null, finished: null }
  // FEAT: o ano de obra corre antes de os modificadores do ano serem colhidos, então o que entra
  // aqui é a camada das obras prontas, nunca a dos acontecimentos
  const progress = building.progress + progressWork(s, workMods(s.works))
  if (progress < def.cost) {
    return { works: s.works, building: { ...building, progress }, finished: null }
  }
  return {
    works: filed(s.works, { def: building.def, done: s.tick, record: nextRecord }),
    building: null,
    finished: building.def,
  }
}
