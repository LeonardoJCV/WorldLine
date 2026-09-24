import { clamp } from './math.ts'
import {
  COLONY_CAPACITY,
  COLONY_ENERGY_BASE,
  COLONY_FLOOR,
  COLONY_FOUND_COST,
  COLONY_GROWTH,
  COLONY_HOLD,
  COLONY_INTAKE,
  COLONY_MIGRATION,
  COLONY_SEED_POP,
  COLONY_SELF,
  COLONY_START_POP,
  COLONY_SUPPORT_HAB,
  COLONY_SUPPORT_NEED,
  COLONY_SUPPORT_RATE,
  COLONY_UPKEEP,
  GENESIS_FOOD_RESERVE,
  INHERIT_ECONOMY,
  INHERIT_ENERGY,
  INHERIT_ENVIRONMENT,
  INHERIT_SHOCK,
} from './params.ts'
import { Era, type WorldState } from './state.ts'
import { colonisable, type Body } from './system.ts'

// FEAT: um só lugar dono do bit da era espacial, agora que `Era` mora em state.ts
export const SPACE_ERA = Era.space

export interface Colony {
  readonly body: number
  readonly founded: number
  readonly population: number
  // FEAT: 0..1, a parte do que a colônia precisa que ela mesma cobre — o mundo natal paga o resto
  readonly support: number
  // FEAT: o acontecimento que registrou a fundação, para a herança poder apontar de volta para ele
  readonly record: number
}

export interface HomeWorld {
  readonly energy: number
  readonly population: number
}

export interface ColonisingWorld extends HomeWorld {
  readonly eras: number
  readonly colonies: readonly Colony[]
  readonly home: number | null
}

export interface ColonyTick {
  readonly colonies: readonly Colony[]
  readonly migrated: number
}

// FEAT: a energia é o que o mundo faz por ano, não um estoque, e só o que passa da base sai daqui
export function spareEnergy(state: HomeWorld): number {
  return Math.max(0, state.energy - COLONY_ENERGY_BASE)
}

function upkeep(colony: Colony): number {
  return COLONY_UPKEEP * clamp(1 - colony.support, 0, 1)
}

export function colonyCost(colonies: readonly Colony[]): number {
  let total = 0
  for (const colony of colonies) total += upkeep(colony)
  return total
}

export function foundColony(
  state: ColonisingWorld,
  bodies: readonly Body[],
  year: number,
  record: number,
): Colony | null {
  if ((state.eras & SPACE_ERA) === 0) return null
  if (spareEnergy(state) - colonyCost(state.colonies) < COLONY_FOUND_COST) return null

  let best: Body | null = null
  for (const body of bodies) {
    if (!colonisable(body)) continue
    // FEAT: o corpo onde a história mora hoje não é destino, mesmo que tenha sido colônia ontem
    if (body.index === state.home) continue
    // FEAT: um corpo que não comporta nem a primeira leva não é destino nenhum
    if (COLONY_CAPACITY * body.habitability < COLONY_START_POP) continue
    if (state.colonies.some((colony) => colony.body === body.index)) continue
    if (best === null || body.habitability > best.habitability) best = body
  }
  if (best === null) return null
  // FEAT: ninguém parte para um corpo que a parte do excedente que lhe cabe não sustentaria
  const seen = (spareEnergy(state) - COLONY_UPKEEP) / (state.colonies.length + 1)
  if (COLONY_SUPPORT_HAB * best.habitability + seen / COLONY_SUPPORT_NEED <= COLONY_HOLD) {
    return null
  }

  return { body: best.index, founded: year, population: COLONY_START_POP, support: 0, record }
}

export function tickColonies(
  colonies: readonly Colony[],
  state: HomeWorld,
  bodies: readonly Body[],
): ColonyTick {
  if (colonies.length === 0) return { colonies: [], migrated: 0 }

  // FEAT: o excedente é partido entre as colônias, e o custo delas não paga o sustento delas
  const share = spareEnergy(state) / colonies.length
  const next: Colony[] = []
  let migrated = 0
  let room = Math.max(0, state.population)

  for (const colony of colonies) {
    const body = bodies[colony.body]
    const reach = body === undefined ? 0 : body.habitability
    // FEAT: o corpo e o que o mundo natal investe dizem até onde a colônia consegue se bastar
    const reachable = clamp(COLONY_SUPPORT_HAB * reach + share / COLONY_SUPPORT_NEED, 0, 1)
    const support = clamp(colony.support + COLONY_SUPPORT_RATE * (reachable - colony.support), 0, 1)
    // FIX: o corpo comporta só tanta gente; manda no ano quem estiver mais apertado, sustento ou lotação
    const holds = COLONY_CAPACITY * reach
    const vacancy = clamp(holds > 0 ? 1 - colony.population / holds : -1, -1, 1)
    const rate = COLONY_GROWTH * Math.min(support - COLONY_HOLD, vacancy)
    const grown = Math.max(0, colony.population * (1 + rate))
    if (grown < COLONY_FLOOR) continue

    // FEAT: ninguém emigra para uma colônia que está minguando; a leva segue o sustento acima do apoio
    const pull = clamp((support - COLONY_HOLD) / (1 - COLONY_HOLD), 0, 1)
    // FIX: a leva para no que resta do corpo, senão a lotação não seria lotação nenhuma
    const leaving = Math.min(
      COLONY_MIGRATION * Math.max(0, state.population) * pull,
      COLONY_INTAKE * colony.population,
      room,
      Math.max(0, holds - grown),
    )
    room -= leaving
    migrated += leaving
    next.push({ ...colony, population: grown + leaving, support })
  }

  return { colonies: next, migrated }
}

export function selfSufficient(colony: Colony): boolean {
  return colony.support >= COLONY_SELF && colony.population >= COLONY_SEED_POP
}

export function heir(colonies: readonly Colony[]): Colony | null {
  let best: Colony | null = null
  for (const colony of colonies) {
    if (!selfSufficient(colony)) continue
    if (best === null || colony.population > best.population) best = colony
  }
  return best
}

// FEAT: a história muda de casa — a gente é a da colônia, os estoques recomeçam pequenos e o
// conhecimento atravessa, porque ele não morre com um planeta
export function inherit(s: WorldState, colony: Colony, body: Body | undefined): WorldState {
  const population = Math.max(0, colony.population)
  return {
    ...s,
    population,
    food: population * GENESIS_FOOD_RESERVE,
    energy: INHERIT_ENERGY,
    economy: INHERIT_ECONOMY,
    environment: clamp(INHERIT_ENVIRONMENT * (body?.habitability ?? 0), 0, 100),
    stability: clamp(s.stability - INHERIT_SHOCK, 0, 100),
    recentEconomy: s.recentEconomy.map(() => INHERIT_ECONOMY),
    // FEAT: a frota que o mundo natal sustentava se perde com ele; só o herdeiro sobrevive, como lar
    colonies: [],
    home: colony.body,
    // FEAT: o que era devido, o que estava a caminho e a contradição que matou o planeta ficam com
    // ele; o herdeiro leva o conhecimento, não as contas — e por isso a realidade volta a correr
    echoes: [],
    debts: [],
    paradox: null,
    strain: 0,
    status: 'running',
  }
}
